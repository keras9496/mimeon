import { useMemo } from "react";
import { hoursSet, SLOT_COLORS } from "../lib/hours";

export type DialSlot = {
  start_hour: number;
  end_hour: number;
} | null;

type Props = {
  slots: DialSlot[]; // 길이 3 권장 — 슬롯 인덱스 = 색 인덱스
  size?: number;
  /** 라이브 미리보기 (모달에서 사용자가 드롭다운 조작 중인 범위) */
  preview?: { start: number; end: number; slotIndex: number } | null;
  /** 점유된 시간 (다른 슬롯이 차지한 시간) — 잠금 표시 */
  lockedHours?: Set<number>;
};

const PAD = 6;
const RING_RATIO = 0.62; // 안쪽 도넛 비율

export function HourDial({ slots, size = 220, preview = null, lockedHours }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - PAD;
  const rInner = rOuter * RING_RATIO;

  // 각 시간(0~23)을 어느 슬롯이 점유하는지 매핑
  const slotByHour = useMemo(() => {
    const map: (number | null)[] = Array(24).fill(null);
    slots.forEach((s, i) => {
      if (!s) return;
      hoursSet(s.start_hour, s.end_hour).forEach((h) => {
        map[h] = i;
      });
    });
    return map;
  }, [slots]);

  const previewSet = useMemo(() => {
    if (!preview) return null;
    return hoursSet(preview.start, preview.end);
  }, [preview]);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="24시간 점유 다이얼">
      <defs>
        <filter id="dial-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#1a1814" floodOpacity="0.06" />
        </filter>
      </defs>

      {/* 바깥 원 배경 */}
      <circle cx={cx} cy={cy} r={rOuter} fill="var(--paper-warm)" stroke="var(--rule)" strokeWidth="1" />

      {/* 24개 wedge (도넛 segment) */}
      {Array.from({ length: 24 }, (_, h) => {
        const isLocked = lockedHours?.has(h) ?? false;
        const slotIdx = slotByHour[h];
        const inPreview = previewSet?.has(h) ?? false;

        let fill = "var(--paper-warm)";
        let opacity = 1;
        if (slotIdx !== null) {
          fill = SLOT_COLORS[slotIdx % SLOT_COLORS.length];
          opacity = 0.92;
        } else if (inPreview) {
          fill = SLOT_COLORS[preview!.slotIndex % SLOT_COLORS.length];
          opacity = 0.55;
        } else if (isLocked) {
          fill = "var(--ink-mute)";
          opacity = 0.18;
        }

        return (
          <path
            key={h}
            d={wedgePath(cx, cy, rInner, rOuter, h, h + 1)}
            fill={fill}
            opacity={opacity}
            stroke="var(--paper)"
            strokeWidth="0.8"
          />
        );
      })}

      {/* 시간 가이드선 (6시 단위 굵게) */}
      {[0, 6, 12, 18].map((h) => {
        const a = hourAngle(h);
        const x1 = cx + Math.cos(a) * rInner;
        const y1 = cy + Math.sin(a) * rInner;
        const x2 = cx + Math.cos(a) * rOuter;
        const y2 = cy + Math.sin(a) * rOuter;
        return <line key={h} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--paper)" strokeWidth="1.5" />;
      })}

      {/* 중앙 라벨 (시 표시) */}
      {[0, 6, 12, 18].map((h) => {
        const a = hourAngle(h);
        const r = rInner - 16;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        return (
          <text
            key={h}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="JetBrains Mono, monospace"
            fontSize={10.5}
            fill="var(--ink-mute)"
            letterSpacing={0.5}
          >
            {String(h).padStart(2, "0")}
          </text>
        );
      })}

      {/* 가운데 도넛 홀 */}
      <circle cx={cx} cy={cy} r={rInner - 1} fill="var(--paper)" />

      {/* 가운데 작은 라벨 */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontFamily="JetBrains Mono, monospace"
        fontSize={9}
        letterSpacing={3}
        fill="var(--ink-mute)"
      >
        24H
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        fontFamily="Noto Serif KR, serif"
        fontSize={13}
        fontWeight={500}
        fill="var(--ink)"
        letterSpacing={-0.3}
      >
        평일 노출
      </text>
    </svg>
  );
}

function hourAngle(h: number): number {
  // 0시가 12시 방향(위), 시계 방향
  return ((h / 24) * 2 * Math.PI) - Math.PI / 2;
}

function wedgePath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  hStart: number,
  hEnd: number
): string {
  const aStart = hourAngle(hStart);
  const aEnd = hourAngle(hEnd);
  const x1 = cx + Math.cos(aStart) * rOuter;
  const y1 = cy + Math.sin(aStart) * rOuter;
  const x2 = cx + Math.cos(aEnd) * rOuter;
  const y2 = cy + Math.sin(aEnd) * rOuter;
  const x3 = cx + Math.cos(aEnd) * rInner;
  const y3 = cy + Math.sin(aEnd) * rInner;
  const x4 = cx + Math.cos(aStart) * rInner;
  const y4 = cy + Math.sin(aStart) * rInner;
  // 1시간 = 15도 — 작은 호이므로 large-arc-flag = 0
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 0 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

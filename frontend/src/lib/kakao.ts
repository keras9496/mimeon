// 카카오 지도 SDK 동적 로더 + 키워드 검색 래퍼
//
// JS키는 도메인 화이트리스트로 보호되므로 (mimeon.onrender.com / localhost) 빌드 번들에 노출돼도 안전.
// services 라이브러리: kakao.maps.services.Places (키워드 검색), Geocoder (주소 → 좌표)

declare global {
  interface Window {
    kakao: any;
  }
}

const APP_KEY = import.meta.env.VITE_KAKAO_MAP_KEY as string | undefined;

let loaderPromise: Promise<void> | null = null;

export function loadKakaoSdk(): Promise<void> {
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    if (!APP_KEY) {
      reject(new Error("VITE_KAKAO_MAP_KEY 가 설정되지 않았습니다."));
      return;
    }
    if (window.kakao && window.kakao.maps) {
      window.kakao.maps.load(() => resolve());
      return;
    }
    const script = document.createElement("script");
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${APP_KEY}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = () => {
      if (!window.kakao || !window.kakao.maps) {
        reject(new Error("카카오 SDK 로드 실패 (도메인 등록 확인)"));
        return;
      }
      window.kakao.maps.load(() => resolve());
    };
    script.onerror = () => reject(new Error("카카오 SDK 스크립트 로드 실패 (네트워크/도메인)"));
    document.head.appendChild(script);
  });

  return loaderPromise;
}

export type PlaceResult = {
  id: string;
  placeName: string;
  addressName: string;
  roadAddressName: string;
  lat: number;
  lon: number;
  categoryName?: string;
};

export async function searchPlace(query: string): Promise<PlaceResult[]> {
  await loadKakaoSdk();
  const places = new window.kakao.maps.services.Places();
  return new Promise((resolve, reject) => {
    places.keywordSearch(query, (results: any[], status: string) => {
      const Status = window.kakao.maps.services.Status;
      if (status === Status.OK) {
        resolve(
          results.map((r) => ({
            id: String(r.id),
            placeName: r.place_name,
            addressName: r.address_name,
            roadAddressName: r.road_address_name,
            lat: parseFloat(r.y),
            lon: parseFloat(r.x),
            categoryName: r.category_name,
          }))
        );
      } else if (status === Status.ZERO_RESULT) {
        resolve([]);
      } else {
        reject(new Error(`검색 실패 (${status})`));
      }
    });
  });
}

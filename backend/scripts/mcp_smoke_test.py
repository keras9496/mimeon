"""MCP 엔드포인트 스모크 테스트 — handshake, tools/list(annotations), 다양한 호출 경로 검증."""
import asyncio

from fastmcp import Client

URL = "http://127.0.0.1:8126/mcp"


async def call(client, name, args):
    res = await client.call_tool(name, args)
    return "".join(getattr(c, "text", "") for c in res.content)


async def main() -> None:
    async with Client(URL) as client:
        tools = await client.list_tools()
        print(f"=== tools ({len(tools)}) ===")
        for t in tools:
            props = list((t.inputSchema or {}).get("properties", {}).keys())
            a = t.annotations
            ok = a and all(v is not None for v in [a.title, a.readOnlyHint, a.destructiveHint, a.idempotentHint, a.openWorldHint])
            print(f"  {t.name}({', '.join(props)})  annotations={'OK' if ok else 'MISSING'}")

        print("\n=== [1] get_air_quality lat/lon (지오코딩 우회) ===")
        print((await call(client, "get_air_quality", {"lat": 37.5665, "lon": 126.978}))[:220])

        print("\n=== [2] get_air_quality address (키 없으면 친절한 에러) ===")
        print((await call(client, "get_air_quality", {"address": "강남역"}))[:220])

        print("\n=== [3] get_air_quality_by_station ===")
        print((await call(client, "get_air_quality_by_station", {"station_name": "종로구"}))[:150])

        print("\n=== [4] analyze_dementia_risk 시간검증 (start==end) ===")
        print((await call(client, "analyze_dementia_risk",
              {"locations": [{"name": "집", "lat": 37.5, "lon": 127.0, "start_hour": 9, "end_hour": 9}]}))[:200])

        print("\n=== [5] analyze_dementia_risk lat/lon 정상 ===")
        out = await call(client, "analyze_dementia_risk",
              {"locations": [{"name": "집", "lat": 37.5665, "lon": 126.978, "start_hour": 20, "end_hour": 8}]})
        print(out[:300])


if __name__ == "__main__":
    asyncio.run(main())

# 일본 공시(EDINET) 원문 연동 — 키 발급 안내

일본 원문 수집 코드(`src/tools/edinet_filings.py`)는 **이미 완성돼 있습니다.**
다만 EDINET API v2 는 2024년부터 **구독키(Subscription-Key)** 를 요구하므로,
키 발급만 사용자가 직접 해야 합니다. 키를 넣는 순간 자동으로 활성화됩니다.

키가 없는 동안에는 일본 종목 분석이 **원문 없이** 진행됩니다(에러 없이 조용히 생략).

## 현재 상태 (실측)

```
GET https://api.edinet-fsa.go.jp/api/v2/documents.json?date=...&type=2
→ 401 {"StatusCode": 401, "message": "Access denied due to invalid subscription key."}
```

서버에서 EDINET 도메인 자체는 **접속 가능**합니다(네트워크 문제가 아니라 키 문제).

## 발급 절차 (약 5분, 무료)

1. <https://api.edinet-fsa.go.jp/> 접속
2. **「アカウント登録」**(계정 등록) → 이메일 인증
3. 로그인 후 **「API キー発行」**(API 키 발급) 메뉴에서 키 생성
4. 발급된 키(32자 내외 문자열)를 복사

## 서버에 적용

```bash
ssh -i "<pem 경로>" admin@43.203.120.8
cd /home/admin/ai-hedge-fund
echo 'EDINET_API_KEY=발급받은키' >> .env
# 백엔드 재시작 (배포 스크립트가 자동 재시작하므로 재배포로 대체해도 됨)
```

적용 확인:

```bash
curl -s "https://hyfin.duckdns.org/hedge-api/sec-filings/7203.T" | head -c 400
```

`"error": "EDINET_API_KEY not configured"` 가 사라지고 `sections` 가 채워지면 성공입니다.

## 참고: 왜 코드를 미리 만들어 뒀나

키만 넣으면 되도록 나머지를 전부 구현해 뒀습니다.

- 증권코드 정규화: `7203.T` → EDINET `secCode` 5자리(`72030`)
- 제출목록을 최근 날짜부터 역순으로 훑어 해당 종목의 최신 보고서 탐색
- 有価証券報告書(docTypeCode `120`) / 四半期・半期報告書(`140`,`160`) 구분
- 본문 ZIP → HTML → 텍스트 → 절 단위 섹션 추출
  - `事業の内容` → Item 1 (사업)
  - `事業等のリスク` → Item 1A (리스크)
  - `経営者による…分析` → Item 7 (MD&A)

## 알려진 한계

- EDINET 은 티커로 직접 조회하는 API가 없어 **날짜별 제출목록을 훑습니다.**
  최대 400일까지 거슬러 찾으며, 첫 조회는 수십 초 걸릴 수 있습니다(이후 6시간 캐시).
- 키 발급 후 첫 종목 조회가 느리면 정상입니다. 필요하면
  `lookback_days` 를 줄여 탐색 범위를 좁힐 수 있습니다.

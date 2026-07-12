# HTTP 함수 런타임 계약

MVP 함수는 특정 언어 handler ABI가 아니라 HTTP 컨테이너 계약을 따릅니다. Node, Python, Go 등 어떤 언어도 아래 조건을 지키면 실행할 수 있습니다.

## 필수 조건

- 모든 interface의 `PORT` 환경 변수 포트에서 HTTP를 수신합니다. 기본 예시는 `8080`입니다.
- 컨테이너 이미지는 linux/amd64 또는 클러스터 node architecture와 일치해야 합니다.
- PID 1에서 `SIGTERM`을 받고 새 요청을 중단한 뒤 진행 중 요청을 종료합니다.
- 이미지의 `USER`는 숫자형 non-root UID여야 하며 root filesystem 쓰기에 의존하지 않습니다.
- 임시 파일은 `/tmp`만 사용하며 현재 크기 제한은 64 MiB입니다.
- 요청·응답은 HTTP status와 `content-type`을 정확히 반환합니다.
- 동일 요청이 재시도될 수 있으므로 부작용이 있는 함수는 idempotency key를 처리합니다.

Knative가 제공하는 `PORT`, `K_REVISION`, `K_SERVICE`, `K_CONFIGURATION`은 예약된 runtime metadata이며 API에서 덮어쓸 수 없습니다.

MVP에서는 함수마다 하나의 Secret만 참조하며 이름은 정확히 `<함수이름>-secrets`여야 합니다. 예를 들어 `hello` 함수는 `hello-secrets`를 참조할 수 있지만 `payment-secrets`는 참조할 수 없습니다. 필요한 여러 원본 값은 ExternalSecret이 이 Secret 하나로 합칩니다.

## 권장 HTTP 규칙

- 동기 JSON 함수는 `POST /`와 `application/json`을 기본으로 사용
- `GET /healthz`는 빠르게 200 반환
- `x-request-id`, `traceparent`, `ce-id`를 로그와 downstream 요청에 전달
- 잘못된 입력은 4xx, 일시적 downstream 장애는 5xx 반환
- 장시간 실행은 HTTP 함수 대신 향후 queue/ScaledJob 경로 사용
- payload는 우선 1 MiB 이하로 제한하고 큰 데이터는 object storage 참조로 전달

## 기본 자원과 스케일

| 항목 | 기본값 | 허용 범위 |
|---|---:|---:|
| timeout | 30초 | 1~600초 |
| concurrency | 10 | 1~1000 |
| min scale | 0 | 0~10 |
| max scale | 10 | 1~20 |
| CPU request/limit | 25m / 250m | namespace LimitRange 이내 |
| memory request/limit | 32Mi / 128Mi | namespace LimitRange 이내 |

낮은 지연이 중요한 함수만 `minScale: 1` 이상으로 설정합니다. scale-to-zero는 유휴 비용을 줄이지만 image pull과 scheduling에 따른 cold start를 제거하지 않습니다.

600초는 Knative의 기본 `max-revision-timeout-seconds`에 맞춘 상한입니다. 더 긴 HTTP timeout이 필요하면 먼저 Knative 전역 설정과 Activator 종료 유예 시간을 함께 검토해야 합니다.

## 이미지 버전

- `latest`를 사용하지 않습니다.
- CI가 생성한 timestamp/commit SHA tag 또는 `@sha256:` digest를 사용합니다.
- 같은 tag에 다른 이미지를 다시 push하지 않습니다.
- rollback은 이전 Knative Revision 또는 이전 이미지 digest로 수행합니다.

[examples/node-http](../examples/node-http)는 이 계약을 만족하는 최소 구현입니다.

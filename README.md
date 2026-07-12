# woostack-functions

Kubernetes 안에서 기존 Woostack 서비스와 함께 실행하는 Lambda 형태의 함수 플랫폼 초안입니다. 이 저장소의 NestJS 애플리케이션은 함수 코드를 직접 실행하지 않고, 함수 정의를 검증해 Knative Service로 변환·관리하는 control plane 역할만 담당합니다.

> 현재 단계는 OCI 이미지 기반 HTTP 함수 MVP입니다. OIDC/사용자별 인가, 소스 빌드, 이벤트 트리거, 과금은 아직 포함하지 않았습니다.

## 구조

```mermaid
flowchart LR
    U["호출자 / 기존 서비스"] --> E["Cloudflare + ingress-nginx"]
    E --> K["Knative 네트워크 계층 (Kourier)"]
    K --> R["Knative Revision"]
    R --> P["함수 Pod + queue-proxy"]

    C["CLI / 내부 관리 UI"] --> A["functions-api (NestJS)"]
    A --> S["Knative Service API"]
    S --> R

    H["Harbor"] --> P
    V["Vault + External Secrets"] --> P
    P --> M["Prometheus / 로그 스택"]
```

역할은 명확히 분리합니다.

- `functions-api`: 함수 CRUD, 입력 정책 검증, 상태 조회, Knative 매니페스트 생성
- Knative Serving: scale-to-zero, 요청 활성화, Revision, 트래픽 전환
- Kourier: Knative 내부 요청 라우팅. 기존 ingress-nginx는 외부 진입점으로 유지
- Harbor: 함수와 control plane의 OCI 이미지 저장
- Vault + External Secrets: 함수가 참조할 Kubernetes Secret 생성
- Prometheus: 플랫폼과 함수 메트릭 수집. 애플리케이션 메트릭 연동은 다음 단계

더 자세한 선택 근거와 단계별 범위는 [docs/architecture.md](docs/architecture.md), API 계약은 [docs/openapi.yaml](docs/openapi.yaml), 함수 런타임 규칙은 [docs/runtime-contract.md](docs/runtime-contract.md)를 참고하세요.

## 현재 구현 범위

- `GET /healthz`: API 프로세스 상태
- `GET /readyz`: Kubernetes의 Knative Serving API 접근 확인
- `GET /v1/functions`: 이 control plane이 관리하는 함수 목록
- `GET /v1/functions/:name`: 함수 상태와 최신 Ready Revision 조회
- `PUT /v1/functions/:name`: Knative Service server-side apply
- `DELETE /v1/functions/:name`: 함수 삭제
- `POST /v1/functions/:name/render`: Kubernetes 연결 없이 매니페스트만 생성
- 기본 `minScale: 0`, 외부 비공개, non-root/read-only filesystem 보안 정책

모든 `/v1/functions` endpoint는 Bearer token을 요구합니다. `FUNCTION_ALLOW_INSECURE_LOCAL=true`는 비-production 로컬 진단에만 사용할 수 있습니다.

Kubernetes의 Knative Service가 MVP의 desired state 저장소입니다. 별도 DB는 사용하지 않습니다. API가 동적으로 관리하는 함수와 Argo CD가 관리하는 같은 Knative Service를 섞으면 field ownership 충돌이 생기므로 한 함수는 둘 중 한 방식으로만 관리해야 합니다.

## 로컬 실행

```bash
pnpm install
FUNCTION_API_TOKEN=local-development-token pnpm start:dev
```

Knative가 없어도 매니페스트 렌더링은 확인할 수 있습니다.

```bash
curl -X POST http://localhost:3000/v1/functions/hello/render \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer local-development-token' \
  --data @examples/node-http/function.json
```

로컬 API가 실제 클러스터에 적용하게 하려면 별도 터미널에서 `kubectl proxy`를 실행한 뒤 다음처럼 시작합니다.

```bash
KUBERNETES_API_URL=http://127.0.0.1:8001 \
FUNCTION_API_TOKEN=local-development-token \
pnpm start:dev
```

```bash
curl -X PUT http://localhost:3000/v1/functions/hello \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer local-development-token' \
  --data @examples/node-http/function.json
```

## 샘플 함수

샘플은 외부 라이브러리가 없는 Node.js HTTP 서버이며 `PORT`, 1 MiB 요청 제한, `SIGTERM`, `K_REVISION`을 처리합니다.

```bash
docker build -t harbor.woostack.dev/functions/hello:202607120001 \
  examples/node-http
docker push harbor.woostack.dev/functions/hello:202607120001
```

이미지는 `latest`가 아닌 태그 또는 digest를 반드시 사용합니다. 함수 컨테이너는 플랫폼 보안 기본값에 맞게 non-root로 실행되고 root filesystem 쓰기에 의존하지 않아야 합니다.

## Kubernetes 배포 초안

`deploy/base`에는 다음만 포함되어 있습니다.

- `functions-system`: control plane namespace
- `functions`: 함수 workload namespace
- namespace 한정 RBAC
- control plane Deployment와 ClusterIP Service
- 함수용 ServiceAccount, LimitRange, ResourceQuota
- 관리 API와 함수 ingress NetworkPolicy

렌더링 확인:

```bash
kubectl kustomize deploy/base
```

적용 전 필수 조건:

1. 실제 Kubernetes 버전을 확인하고 호환되는 Knative Serving 버전을 고정합니다.
2. Knative 네트워크 계층을 설치합니다. 현재 환경에서는 Kourier가 우선 후보이며 `secure-pod-defaults: enabled`도 함께 설정합니다.
3. `functions-system`, `functions` 양쪽에 `harbor-secret`을 ExternalSecret으로 생성합니다.
4. `functions-system/functions-api-auth` Secret의 `token` key를 ExternalSecret으로 생성합니다.
5. `harbor.woostack.dev/woostack/functions-api:0.0.1` 이미지를 빌드·푸시합니다.
6. wildcard 함수 도메인과 Cloudflare → ingress-nginx → Kourier 경로를 정합니다.
7. shared token은 부트스트랩 용도로만 사용하고, 외부 공개 전에 OIDC/RBAC으로 교체합니다.

실제 클러스터 선언은 기존 관례에 맞춰 Knative/컨트롤러를 `woostack-gitops/infra/`, 함수 namespace·Secret·공개 Route를 `woostack-gitops/apps/functions/`에서 소유하는 구성이 적합합니다. 이 저장소의 `deploy/base`는 그 GitOps 작업을 시작하기 위한 애플리케이션 초안입니다.

## 설정

| 환경 변수 | 기본값 | 설명 |
|---|---:|---|
| `PORT` | `3000` | control plane HTTP 포트 |
| `FUNCTION_NAMESPACE` | `functions` | 함수 Knative Service namespace |
| `FUNCTION_SERVICE_ACCOUNT` | `function-runtime` | 함수 Pod ServiceAccount |
| `FUNCTION_API_TOKEN` | 없음 | 관리 API Bearer token; 없으면 관리 API 차단 |
| `FUNCTION_ALLOW_INSECURE_LOCAL` | `false` | 비-production에서만 token 검사를 끄는 명시적 escape hatch |
| `KUBERNETES_API_URL` | in-cluster API | 로컬 프록시 등 Kubernetes API 주소 |
| `KUBERNETES_TOKEN` | mounted token | API 인증 토큰 |
| `KUBERNETES_CA_FILE` | mounted `ca.crt` | API 서버 CA 파일 |
| `KUBERNETES_API_TIMEOUT_MS` | `5000` | API 요청 timeout |
| `KUBERNETES_MAX_RESPONSE_BYTES` | `5242880` | API 응답 버퍼 상한 |
| `KUBERNETES_SKIP_TLS_VERIFY` | `false` | 로컬 진단 외에는 사용 금지 |

## 검증

```bash
pnpm build
pnpm test -- --runInBand
pnpm test:e2e -- --runInBand
pnpm exec eslint "{src,test}/**/*.ts"
kubectl kustomize deploy/base
```

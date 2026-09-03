# M02. 배포 파이프라인

뼈대만 있는 상태에서 배포를 먼저 뚫는다. 이후 모든 마일스톤을 **배포된 상태로 검증**한다.

**완료 조건**: `main` 에 머지하면 세 웹 앱과 API 가 자동 배포되고, `shop.<도메인>` 에서 헬스체크 결과가 보인다.

| ID | 제목 | 상태 | 선행 |
| --- | --- | --- | --- |
| [TASK-0008](./TASK-0008-domain-dns.md) | 도메인 확보 · DNS 구성 | 승인 대기 | M01 |
| [TASK-0009](./TASK-0009-backend-deploy.md) | 백엔드 배포 (API·DB·검색) | 승인됨 | M01 |
| [TASK-0010](./TASK-0010-frontend-deploy.md) | 프론트 배포 (Vercel × 3) | 승인됨 | 0008, 0009 |
| [TASK-0011](./TASK-0011-object-storage.md) | 오브젝트 스토리지 (R2) | 진행중 | 0009 |
| [TASK-0012](./TASK-0012-cd-pipeline.md) | 배포 자동화 · 환경변수 관리 | 승인 대기 | 0010 |
| [TASK-0013](./TASK-0013-observability.md) | 로그 · 에러 추적 · 모니터링 | 승인 대기 | 0012 |
| [TASK-0101](./TASK-0101-cold-start.md) | 콜드 스타트 대응 · 웨이크업 UX | 완료 | 0010 |

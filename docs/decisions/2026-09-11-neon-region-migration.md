# 2026-09-11 Neon 리전 이전

## D-277 API와 DB의 리전 정렬

사용자 승인으로 Neon 운영 DB를 Ohio에서 Singapore 새 프로젝트로 이전했다. Render API를 중지한 뒤 PostgreSQL18 dump/restore와 전체 데이터·스키마·원장 대사를 확인하고 DATABASE_URL을 전환했다. 신규 운영 주문이 Singapore에만 저장되는 것으로 연결 전환을 확인했다. API 리전은 blueprint상Singapore이며 사용자도 실제 대시보드의 Singapore를 확인했다.

Ohio 원본과 백업은 별도 삭제 결정 전까지 유지한다. 대상에 새 쓰기가 생긴 뒤에는 연결 문자열만 원본으로 되돌리지 않고 writer 중지 및 변경분 복원/대사를 선행한다. DB/이미지/앱의 서비스 분리는 유지한다. [검증](../reviews/2026-09-11-neon-region-migration.md).

# TASK0137 구현 검증

세 앱은 공통 ProductThumbnail/ProductIdentity와 useImageFailure를 사용한다. 상품 카드·갤러리는 기존 레이아웃과 Next Image 슬롯을 유지한다. 시드 자산은 shop 원본에서 seller/admin 빌드 입력으로 복사된다. 관리자 상품 표의 내부 가로 스크롤은 layout containment로 문서 전체 폭 전파를 방지한다.

UI 전체 961개, shop 1,275개(기존 skip1), seller 867개, admin 1,164개 통과. 세 앱/UI 타입·린트 및 세 앱 build 통과. 관리자 표 후속 수정 관련 21개 검사 통과. 전체 웹 동시 검사는 로컬 메모리 사용량 때문에 중단하고 앱별 maxWorkers=2로 재실행한 결과다.

브라우저는 API 계약 대역과 실제 앱 이미지 파일을 사용한다. shop 로그인/비로그인 홈/최근 본 및 찜 5경로에서 디코딩 성공과 비로그인 localStorage 보존 확인. seller/admin 상품 목록 각각 360/768/1440px 총6경로에서 실제 시드 이미지 디코딩 및 문서 가로 넘침 0건 확인. [원자료](artifacts/thumbnail-consistency/). 모든 상품 행의 실제 운영 데이터 테스트를 의미하지 않는다.

PR CI와 운영 배포, 범위 전체의 운영 검증은 아직 남아 있다.

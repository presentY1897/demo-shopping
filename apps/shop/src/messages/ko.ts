import type { Messages } from './types'

export const ko: Messages = {
  app: {
    name: '구매자 앱',
    description: '상품을 둘러보고 주문하는 구매자용 앱입니다.',
  },
  health: {
    title: 'API 연결 상태',
    endpointLabel: '엔드포인트',
    // Keys the payload may carry. `database` is listed ahead of its arrival with
    // Prisma (TASK-0005) so that it shows a Korean label the day it appears; an
    // unlisted key still renders, under its raw name.
    itemLabels: {
      status: '전체 상태',
      search: '검색엔진',
      database: '데이터베이스',
    },
    statusLabels: {
      ok: '정상',
      degraded: '일부 장애',
      down: '중단',
    },
    uptimeLabel: '가동 시간',
    uptimeUnit: '초',
    versionLabel: 'API 버전',
    failureTitle: 'API 에 연결하지 못했습니다',
    failures: {
      network: 'API 서버에 닿지 못했습니다. 실행 중인지 확인해주세요.',
      timeout: 'API 응답이 제한 시간 안에 오지 않았습니다.',
      aborted: '요청이 취소되었습니다.',
      http: 'API 가 오류를 응답했습니다.',
      malformed_response: 'API 응답 형식이 예상과 다릅니다.',
      configuration: 'API 주소 설정이 없습니다. pnpm dev 로 실행했는지 확인해주세요.',
      unknown: '알 수 없는 오류가 발생했습니다.',
    },
    notice: '기동 확인용 임시 페이지입니다. 실제 화면은 M03 에서 대체됩니다.',
  },
  tokens: {
    title: '디자인 토큰',
    description: '색·타이포·간격·밀도 토큰을 한 화면에서 확인하는 개발용 페이지입니다.',
    devOnlyNotice: '개발 환경에서만 열립니다. 프로덕션 빌드에서는 404 를 응답합니다.',
    linkLabel: '디자인 토큰 미리보기',
    density: {
      legend: '표시 밀도',
      names: {
        1: '미니멀',
        2: '표준',
        3: '맥시멀',
      },
      current: '현재 밀도',
      hint: '선택한 값은 이 브라우저에 저장되어 새로고침 후에도 유지됩니다.',
    },
    sections: {
      color: '색',
      typography: '타이포그래피',
      spacing: '간격',
      shape: '모서리 · 그림자',
      control: '컨트롤 크기 · 터치 타깃',
      grid: '밀도 × 뷰포트 그리드',
      comparison: '밀도 3단계 비교',
    },
    captions: {
      color:
        '컴포넌트는 시맨틱 토큰만 사용합니다. 팔레트는 시맨틱 토큰이 참조하는 원본 값이며 화면에서 직접 쓰지 않습니다.',
      typography: '글자 크기는 밀도 배율(--font-scale)과 함께 움직입니다.',
      spacing:
        '모든 간격은 --space-unit 의 배수입니다. 밀도를 바꾸면 아래 막대 길이가 함께 바뀝니다.',
      shape: '모서리 반경은 밀도 배율(--radius-scale)을 따릅니다. 그림자는 밀도와 무관합니다.',
      control:
        '어떤 밀도에서도 44px 아래로 내려가지 않습니다. 브라우저가 실제로 렌더한 높이를 함께 표시합니다.',
      grid: '열 수는 밀도와 뷰포트의 2차원 매트릭스로 정해집니다. 창 너비를 바꾸면 값이 바뀝니다.',
      comparison:
        '세 단계를 한 화면에서 비교합니다. 각 패널은 자기 밀도로 렌더되며 페이지 전체 밀도와 무관합니다.',
    },
    labels: {
      palette: '팔레트',
      semantic: '시맨틱',
      measuredHeight: '실제 높이',
      measuring: '측정 중',
      columns: '열',
      columnsFromCss: 'CSS 변수',
      columnsFromMatrix: 'TypeScript 매트릭스',
      viewportWidth: '창 너비',
      sampleText: '가나다라 Ag 123',
      sampleButton: '버튼',
      iconButton: '아이콘 버튼',
      touchFloor: '터치 하한 44px',
    },
  },
}

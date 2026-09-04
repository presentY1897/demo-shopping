import type { Messages } from './types'

export const ko: Messages = {
  app: {
    name: '판매자 콘솔',
    description: '상품과 주문, 정산을 관리하는 판매자용 콘솔입니다.',
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
  wake: {
    loadingLabel: 'API 연결 상태를 불러오는 중입니다.',
    preparing: '서버를 준비하는 중입니다',
    preparingHint: '잠시만 기다려주세요. 준비가 끝나면 자동으로 표시됩니다.',
    // 사실 안내이지 변명이 아니다(TASK-0101 R1). 실측 90초에 여유를 얹어
    // "최대 2분"으로 적는다 — 90초라고 적으면 91초에 거짓말이 된다.
    coldStartNotice:
      '무료 플랜 데모 환경이라 한동안 방문이 없으면 서버가 절전 상태로 들어갑니다. 처음 접속은 최대 2분까지 걸릴 수 있습니다.',
    elapsedLabel: '경과',
    secondsUnit: '초',
    attemptLabel: '시도',
    progressLabel: '서버 준비 진행률',
    failureTitle: '서버를 깨우지 못했습니다',
    failureHint: '네트워크가 돌아오거나 이 탭으로 돌아오면 자동으로 다시 시도합니다.',
    retryLabel: '다시 시도',
    search: {
      title: '검색',
      ready: '검색을 사용할 수 있습니다.',
      preparingTitle: '검색을 준비하는 중입니다',
      waking: '검색 서버가 절전 상태에서 깨어나는 중입니다. 준비되면 검색할 수 있습니다.',
      indexing: '검색 색인을 다시 만드는 중입니다. 지금 검색하면 결과가 비어 보일 수 있습니다.',
      autoRecheck: '자동으로 다시 확인하고 있습니다.',
      recheckLabel: '다시 확인',
    },
  },
  layout: {
    // 콘솔 이름. 사이드바 위와 모바일 시트 제목에 같은 문자열이 쓰인다.
    brand: '판매자 콘솔',
    shell: {
      skipToContent: '본문 바로가기',
      navLabel: '주요 메뉴',
      openNav: '메뉴 열기',
      collapseSidebar: '사이드바 접기',
      expandSidebar: '사이드바 펼치기',
      closeNav: '메뉴 닫기',
      navSheetDescription: '콘솔의 모든 화면을 여기에서 엽니다.',
    },
    // 경로와 순서는 docs/design/pages.md 가 유일한 출처다. 절 제목만 이
    // TASK 의 분류다(TASK-0019 4.9). M04 가 이 정의 앞에 권한 필터를 얹는다.
    menu: [
      { id: 'overview', items: [{ href: '/', label: '대시보드' }] },
      {
        id: 'sales',
        label: '판매',
        items: [
          { href: '/products', label: '상품 관리' },
          { href: '/orders', label: '주문 관리' },
          { href: '/claims', label: '취소·반품' },
        ],
      },
      {
        id: 'customers',
        label: '고객',
        items: [
          { href: '/reviews', label: '리뷰 관리' },
          { href: '/questions', label: '문의 관리' },
        ],
      },
      {
        id: 'settlement',
        label: '정산·설정',
        items: [
          { href: '/coupons', label: '쿠폰' },
          { href: '/settlements', label: '정산 내역' },
          { href: '/settings', label: '스토어 설정' },
        ],
      },
    ],
    notifications: {
      label: '알림',
      title: '알림',
      body: '알림함은 M11 에서 이 자리에 들어옵니다.',
      closeLabel: '닫기',
    },
    account: {
      label: '내 계정',
      title: '내 계정',
      body: '로그인과 계정 메뉴는 M04 에서 이 자리에 들어옵니다.',
      closeLabel: '닫기',
    },
  },
  placeholder: {
    comingSoon: '준비 중',
    body: '이 화면은 해당 도메인 마일스톤에서 열립니다. 지금은 콘솔 레이아웃을 확인하는 자리입니다.',
    // 메뉴 항목이 아닌 하위 경로. 여기서만 제목이 필요하다.
    productNew: '상품 등록',
  },
  routeStates: {
    loadingLabel: '화면을 불러오는 중입니다',
    notFoundTitle: '찾을 수 없는 화면입니다',
    notFoundBody: '주소가 바뀌었거나 아직 만들어지지 않은 화면입니다.',
    errorTitle: '화면을 표시하지 못했습니다',
    errorBody: '잠시 후 다시 시도해주세요. 문제가 계속되면 새로고침해주세요.',
    retryLabel: '다시 시도',
    homeLabel: '대시보드로',
  },
  components: {
    title: '기본 컴포넌트',
    description: 'packages/ui 의 기본 컴포넌트를 한 화면에서 확인하는 개발용 페이지입니다.',
    devOnlyNotice: '개발 환경에서만 열립니다. 프로덕션 빌드에서는 404 를 응답합니다.',
    linkLabel: '기본 컴포넌트 미리보기',
    density: {
      legend: '표시 밀도',
      names: {
        1: '미니멀',
        2: '표준',
        3: '맥시멀',
      },
      hint: '밀도를 바꾸면 간격·글자 크기·모서리가 함께 움직입니다. 터치 타깃은 어떤 단계에서도 44 픽셀 아래로 내려가지 않습니다.',
    },
    sections: {
      action: '액션 — 버튼 · 아이콘 버튼 · 링크',
      form: '폼 — 입력 · 선택 · 토글',
      display: '표시 — 배지 · 태그 · 아바타 · 구분선',
      overlay: '오버레이 — 모달 · 드로어 · 툴팁 · 팝오버',
      feedback: '알림 — 토스트',
      structure: '구조 — 탭 · 아코디언',
    },
    action: {
      variants: {
        primary: '기본',
        secondary: '보조',
        outline: '외곽선',
        ghost: '고스트',
        danger: '위험',
      },
      sizes: {
        sm: '작게',
        md: '보통',
        lg: '크게',
      },
      disabled: '비활성',
      loading: '처리 중',
      submit: '제출',
      submitted: '제출 횟수',
      iconLabel: '닫기',
      link: '주문 내역',
      externalLink: 'WAI-ARIA 작성 패턴',
      externalHint: '(새 창)',
    },
    form: {
      emailLabel: '이메일',
      emailPlaceholder: 'buyer@example.com',
      invalidLabel: '이메일 (오류 상태)',
      invalidValue: 'buyer@',
      messageLabel: '요청사항',
      messagePlaceholder: '배송 시 요청사항을 입력해주세요.',
      categoryLabel: '카테고리',
      categoryPlaceholder: '카테고리를 선택해주세요',
      categories: [
        { value: 'outer', label: '아우터' },
        { value: 'knit', label: '니트' },
        { value: 'shoes', label: '신발' },
      ],
      agree: '이용약관에 동의합니다',
      agreeDescription: '필수 항목입니다.',
      marketing: '마케팅 정보 수신에 동의합니다',
      shippingLabel: '배송 방법',
      shipping: [
        { value: 'standard', label: '일반 배송' },
        { value: 'express', label: '빠른 배송' },
        { value: 'pickup', label: '매장 수령' },
      ],
      notifications: '주문 알림 받기',
    },
    display: {
      badges: {
        neutral: '대기',
        primary: '진행중',
        success: '완료',
        warning: '확인 필요',
        danger: '실패',
      },
      tags: [
        { id: 'color', label: '색상: 블랙' },
        { id: 'size', label: '사이즈: M' },
        { id: 'price', label: '10만원 이하' },
      ],
      removeLabel: '필터 제거',
      avatarName: '김민준',
      dividerLabel: '또는',
    },
    overlay: {
      closeLabel: '닫기',
      confirm: '확인',
      cancel: '취소',
      openModal: '모달 열기',
      modalTitle: '주문을 취소할까요?',
      modalDescription: '취소한 주문은 되돌릴 수 없습니다.',
      modalBody: '결제 금액은 영업일 기준 3일 이내에 환불됩니다.',
      drawerSides: {
        left: '드로어 · 왼쪽',
        right: '드로어 · 오른쪽',
        top: '드로어 · 위',
        bottom: '드로어 · 아래',
      },
      drawerTitle: '필터',
      drawerDescription: '조건을 선택해 상품 목록을 좁힙니다.',
      drawerBody: '카테고리 · 가격 · 색상 필터가 이 자리에 들어갑니다.',
      tooltipTrigger: '툴팁',
      tooltipContent: '이 주문에만 적용되는 할인입니다.',
      popoverTrigger: '팝오버',
      popoverTitle: '쿠폰 입력',
      popoverBody: '보유한 쿠폰 번호를 입력하면 즉시 적용됩니다.',
    },
    feedback: {
      regionLabel: '알림',
      closeLabel: '알림 닫기',
      variants: {
        neutral: '일반',
        success: '성공',
        warning: '주의',
        danger: '오류',
      },
      toastTitle: '주문이 취소되었습니다',
      toastDescription: '판매자에게 취소 요청이 전달되었습니다.',
    },
    structure: {
      tabs: [
        { value: 'items', label: '주문 상품', body: '주문한 상품 목록이 표시됩니다.' },
        { value: 'shipping', label: '배송', body: '배송 상태와 운송장 번호가 표시됩니다.' },
        { value: 'payment', label: '결제', body: '결제 수단과 금액 내역이 표시됩니다.' },
      ],
      accordion: [
        { value: 'shipping', label: '배송 안내', body: '5만원 이상 구매 시 무료 배송입니다.' },
        { value: 'returns', label: '교환 · 반품', body: '수령 후 7일 이내에 신청할 수 있습니다.' },
        {
          value: 'support',
          label: '고객센터',
          body: '평일 오전 10시부터 오후 6시까지 운영합니다.',
        },
      ],
    },
  },
}

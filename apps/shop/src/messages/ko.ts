import type { Messages } from './types'

export const ko: Messages = {
  app: {
    // 구매자 앱은 셋 중 유일하게 '브랜드'를 가진다 — 콘솔 둘은 도구이고
    // 이쪽은 손님이 보는 가게다. 헤더 로고와 <title> 이 같은 이름을 쓴다.
    name: '데모 마켓',
    description: '가상 브랜드로 꾸민 멀티 셀러 마켓플레이스 데모입니다.',
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
    notice: '상품 데이터가 붙기 전까지 API 연결 상태를 이 자리에 표시합니다.',
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
    skipToContent: '본문 바로가기',
    homeLabel: '홈으로',
    nav: {
      label: '카테고리',
      openMenu: '메뉴 열기',
      closeMenu: '메뉴 닫기',
      menuTitle: '전체 메뉴',
      menuDescription: '카테고리와 검색을 여기에서 엽니다.',
      // 패션 중심 초기 카테고리(DECISIONS 1장). TASK-0042 에서 카탈로그
      // API 가 내려주는 트리로 대체된다.
      categories: [
        { slug: 'outerwear', label: '아우터' },
        { slug: 'tops', label: '상의' },
        { slug: 'bottoms', label: '하의' },
        { slug: 'shoes', label: '신발' },
        { slug: 'bags', label: '가방' },
        { slug: 'accessories', label: '액세서리' },
      ],
      pendingLabel: '이동 중',
    },
    search: {
      label: '상품 검색',
      placeholder: '어떤 상품을 찾으세요?',
      submit: '검색',
    },
    density: {
      legend: '표시 밀도',
      names: {
        1: '미니멀',
        2: '표준',
        3: '맥시멀',
      },
      openLabel: '표시 밀도 바꾸기',
      hintTitle: '보기 방식을 고를 수 있습니다',
      hintBody: '한 화면에 담기는 정보량을 세 단계로 바꿉니다. 고른 값은 다음 방문에도 유지됩니다.',
      hintDismiss: '안내 닫기',
    },
    account: {
      cart: '장바구니',
      mypage: '마이페이지',
    },
    footer: {
      label: '사이트 정보',
      demoTitle: '포트폴리오 데모',
      demoBody:
        '실제 판매가 이루어지지 않는 데모 사이트입니다. 브랜드와 상품은 모두 가상으로 만든 것입니다.',
      densityTitle: '표시 밀도 3단계',
      densityBody: '헤더의 밀도 버튼으로 간격과 정보량을 바꿀 수 있습니다.',
      copyright: '© 2026 데모 마켓',
    },
  },
  home: {
    title: '오늘의 추천',
    description: '카탈로그가 붙기 전까지 레이아웃과 표시 밀도를 확인하는 화면입니다.',
    previewTitle: '표시 밀도 미리보기',
    previewDescription:
      '헤더에서 밀도를 바꾸면 아래 카드의 열 수와 간격이 함께 바뀝니다. 실제 상품 카드는 M06 에서 이 자리에 들어옵니다.',
    previewItems: [
      '울 코트',
      '리넨 셔츠',
      '데님 팬츠',
      '가죽 벨트',
      '캐시미어 머플러',
      '캔버스 토트백',
    ],
    previewImageLabel: '이미지 자리',
    previewPriceLabel: '가격 자리',
  },
  placeholder: {
    comingSoon: '준비 중',
    search: {
      title: '검색',
      body: '검색 결과 화면은 M06 에서 열립니다. 지금은 입력한 검색어만 확인할 수 있습니다.',
      queryLabel: '검색어',
    },
    category: {
      title: '카테고리',
      body: '카테고리별 상품 목록은 M06 에서 열립니다.',
    },
    cart: {
      title: '장바구니',
      body: '장바구니는 M07 에서 열립니다.',
    },
    mypage: {
      title: '마이페이지',
      body: '마이페이지는 로그인이 생기는 M04 이후에 열립니다.',
    },
  },
  routeStates: {
    loadingLabel: '화면을 불러오는 중입니다',
    notFoundTitle: '찾을 수 없는 화면입니다',
    notFoundBody: '주소가 바뀌었거나 아직 만들어지지 않은 화면입니다.',
    errorTitle: '화면을 표시하지 못했습니다',
    errorBody: '잠시 후 다시 시도해주세요. 문제가 계속되면 새로고침해주세요.',
    retryLabel: '다시 시도',
    homeLabel: '홈으로',
  },
  // 로그인과 권한 안내 (TASK-0023). 아래 레코드는 전부 @shopping/shared 가
  // 소유한 유니온으로 키가 잡혀 있어, 값이 하나 늘면 여기가 typecheck 에서
  // 걸린다. 사용자가 한 행동의 언어로 쓰고 다음에 무엇을 할지 말한다.
  auth: {
    signIn: {
      title: '로그인',
      description: 'Google 계정으로 로그인하면 주문 내역과 장바구니가 계정에 저장됩니다.',
      googleLabel: 'Google 계정으로 계속하기',
      demoLabel: '데모 계정 받기',
      demoReason: '데모 계정 발급은 곧 열립니다. 지금은 Google 로그인만 쓸 수 있어요.',
      checkingLabel: '로그인 상태를 확인하는 중입니다',
      signedInTitle: '이미 로그인되어 있습니다',
      signedInBody: '계속 둘러보시려면 아래 버튼을 눌러주세요.',
      continueLabel: '계속하기',
      configurationTitle: '로그인을 시작할 수 없습니다',
      configurationBody: 'API 주소 설정이 없습니다. pnpm dev 로 실행했는지 확인해주세요.',
    },
    outcome: {
      failureTitle: '로그인하지 못했습니다',
      cancelled: '로그인을 취소했습니다. 언제든 다시 시도할 수 있어요.',
      generic: '로그인을 끝내지 못했습니다. 다시 시도해주세요.',
      // 콜백이 실어 보내는 네 가지 사유(TASK-0021). 운영자에게 도움이 되는
      // 상세는 서버 로그의 requestId 옆에 있고, 여기에는 다음 행동만 적는다.
      failures: {
        state_mismatch: '로그인 요청이 만료됐습니다. 다시 시도해주세요.',
        exchange_failed: 'Google 인증을 마치지 못했습니다. 잠시 후 다시 시도해주세요.',
        profile_failed: 'Google 계정 정보를 읽지 못했습니다. 다시 시도해주세요.',
        not_configured: '이 환경에서는 Google 로그인을 쓸 수 없습니다.',
      },
      notices: {
        no_role: '로그인은 됐지만 이 화면에서 쓸 수 있는 권한이 없습니다.',
      },
      sessions: {
        unknown: '로그인이 필요합니다.',
        expired: '로그인이 만료됐습니다. 다시 로그인해주세요.',
        reused: '보안을 위해 로그아웃했습니다. 다시 로그인해주세요.',
        unreachable: '서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',
      },
    },
    // API 403 의 details 와 같은 어휘를 쓴다 — 버튼이 말하는 이유와 호출이
    // 거절되는 이유가 달라지면 안 된다.
    denials: {
      checking: '로그인 상태를 확인하는 중입니다.',
      signed_out: '로그인이 필요한 기능입니다.',
      missing_permission: '이 계정으로는 할 수 없는 작업입니다.',
      out_of_scope: '내 것이 아닌 항목에는 할 수 없는 작업입니다.',
    },
    menu: {
      label: '마이페이지',
      title: '내 계정',
      closeLabel: '닫기',
      signedOutBody: '로그인하면 주문 내역과 장바구니를 계정에 저장할 수 있습니다.',
      signInLabel: '로그인',
      signOutLabel: '로그아웃',
      rolesLabel: '권한',
      roleNames: {
        BUYER: '구매자',
        SELLER_OWNER: '판매자',
        ADMIN_OPERATOR: '운영자',
        ADMIN_SUPER: '관리자',
        DEMO_ADMIN: '데모 관리자',
      },
      profileLabel: '프로필 설정',
      profileReason: '프로필 편집은 곧 열립니다.',
    },
    requireSignIn: {
      title: '로그인이 필요합니다',
      body: '이 화면은 로그인한 뒤에 볼 수 있습니다.',
      action: '로그인하러 가기',
      checkingLabel: '로그인 상태를 확인하는 중입니다',
    },
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

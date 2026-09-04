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
  // API 가 코드로 말하는 실패의 문장 (TASK-0117). 서버도 문장을 보내지만 그것은
  // 이 카탈로그에 없는 코드를 위한 대비책이다. 사용자가 한 행동의 언어로 쓰고,
  // 다음에 무엇을 할지 말하고, 내부 식별자를 쓰지 않는다.
  errors: {
    BAD_REQUEST: '입력하신 값을 다시 확인해 주세요.',
    VALIDATION_FAILED: '입력하신 값을 다시 확인해 주세요.',
    UNAUTHORIZED: '로그인이 필요해요.',
    FORBIDDEN: '이 작업을 할 수 있는 권한이 없어요. 내 스토어가 맞는지 확인해 주세요.',
    NOT_FOUND: '찾으시는 것이 없어요. 목록을 새로고침해 주세요.',
    METHOD_NOT_ALLOWED: '지금은 처리할 수 없는 요청이에요. 새로고침한 뒤 다시 시도해 주세요.',
    CONFLICT: '다른 곳에서 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 시도해 주세요.',
    PAYLOAD_TOO_LARGE: '파일이 너무 커요. 더 작은 파일을 선택해 주세요.',
    UNSUPPORTED_MEDIA_TYPE: '지원하지 않는 형식이에요. JPG · PNG · WebP 만 올릴 수 있어요.',
    TOO_MANY_REQUESTS: '요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.',
    INTERNAL_ERROR: '잠시 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    SERVICE_UNAVAILABLE: '이미지 저장소가 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.',
    AUTH_REQUIRED: '로그인이 필요해요.',
    INVALID: '입력하신 값을 다시 확인해 주세요.',
    // 아래 카탈로그 코드는 판매자 화면에서 나오지 않지만, 코드 목록이 늘어나면
    // 문장도 함께 늘어야 한다는 것을 타입이 강제한다 (TASK-0117 4.7 J2).
    CATEGORY_SLUG_TAKEN: '이미 쓰고 있는 주소예요. 다른 주소를 입력해 주세요.',
    CATEGORY_VERSION_CONFLICT: '다른 곳에서 먼저 저장했어요. 최신 내용을 불러올까요?',
    CATEGORY_HAS_CHILDREN: '하위 분류를 먼저 옮기거나 삭제해 주세요.',
    CATEGORY_MAX_DEPTH: '분류를 더 깊게 만들 수 없어요.',
    CATEGORY_MOVE_INTO_SELF: '분류를 자기 자신이나 그 아래로 옮길 수 없어요.',
    CATEGORY_REORDER_MISMATCH: '순서가 화면과 어긋났어요. 새로고침한 뒤 다시 시도해 주세요.',
    CATEGORY_PARENT_MISSING: '선택한 상위 분류가 없어졌어요. 목록을 새로고침해 주세요.',
    ATTRIBUTE_KEY_TAKEN: '같은 이름의 속성이 이미 있어요.',
    ATTRIBUTE_VERSION_CONFLICT: '다른 곳에서 먼저 저장했어요. 최신 내용을 불러올까요?',
  },
  // 응답이 아예 오지 않은 실패. 읽을 코드가 없으므로 번호도 보여 주지 않는다.
  apiFailures: {
    network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
    timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
    aborted: '요청을 취소했어요.',
    malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
    configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
    unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  },
  // 이미지 업로드 위젯 (TASK-0033). packages/ui 는 문구를 갖지 않으므로 행
  // 버튼의 이름까지 전부 여기서 나간다.
  imageUpload: {
    title: '상품 이미지',
    description:
      '첫 번째 이미지가 목록과 상세의 대표 이미지가 됩니다. 순서를 바꾸면 구매자에게 보이는 순서도 바뀝니다.',
    hint: 'JPG · PNG · WebP · 한 장당 5MB 까지 · 최대 10장. 긴 변이 2,000픽셀을 넘으면 올리기 전에 줄입니다.',
    pickLabel: '이미지를 끌어다 놓거나 파일을 선택하세요',
    dropLabel: '여기에 놓으세요',
    fullNotice: '이미지를 10장까지 등록했습니다. 더 올리려면 먼저 하나를 빼주세요.',
    emptyDescription: '아직 등록한 이미지가 없습니다.',
    retryAllLabel: '실패한 것만 다시 시도',
    rejectedTitle: '올리지 않은 파일이 있습니다',
    rejections: {
      unsupportedType: 'JPG · PNG · WebP 만 올릴 수 있어요.',
      tooManyImages: '이미지는 10장까지 등록할 수 있어요.',
    },
    noticeTitle: '이미지를 올리지 못했습니다',
    requestIdLabel: '문의 번호',
    requestIdHint: '문의하실 때 이 번호를 알려주시면 훨씬 빨리 찾을 수 있습니다.',
    copyLabel: '복사',
    copiedLabel: '복사했습니다',
    list: {
      listLabel: '등록한 이미지',
      primaryBadge: '대표',
      progressLabel: '업로드 진행률',
      statusLabels: {
        queued: '대기 중',
        preparing: '이미지를 줄이는 중',
        requesting: '업로드 준비 중',
        uploading: '올리는 중',
        uploaded: '완료',
        failed: '실패',
      },
      moveUp: '앞으로',
      moveDown: '뒤로',
      makePrimary: '대표로',
      retry: '다시 시도',
      cancel: '취소',
      remove: '빼기',
    },
    failures: {
      unsupportedType: 'JPG · PNG · WebP 만 올릴 수 있어요.',
      tooManyImages: '이미지는 10장까지 등록할 수 있어요.',
      tooLarge: '줄인 뒤에도 5MB 를 넘어요. 다른 사진을 선택해 주세요.',
      decodeFailed: '이미지를 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.',
      // 브라우저는 이 둘을 구분해 주지 않는다. R2 의 403 응답에는 CORS 헤더가
      // 없어서 만료된 주소도, 프리플라이트 거부도, 끊긴 네트워크도 전부
      // "응답 없음"으로 도착한다(TASK-0033 4.9 실측). 그래서 blocked 의 문장이
      // 가장 흔한 원인인 만료를 먼저 말하고, 다시 시도가 실제 해결책이다 —
      // 재시도는 presign 부터 다시 하므로 주소를 새로 받는다.
      blocked:
        '이미지를 올리지 못했어요. 업로드 주소가 만료됐거나 네트워크가 끊겼을 수 있어요. 다시 시도하면 새 주소를 받습니다.',
      rejected: '업로드 주소가 만료됐어요. 다시 시도해 주세요.',
      timeout: '업로드가 제한 시간을 넘겼어요. 다시 시도해 주세요.',
      aborted: '업로드를 취소했어요.',
      http: '저장소가 업로드를 받지 못했어요. 잠시 후 다시 시도해 주세요.',
    },
    preview: {
      title: '이미지 업로드 위젯',
      devOnlyNotice:
        '개발 환경에서만 열립니다. 프로덕션 빌드에서는 404 를 응답합니다. 상품 등록 화면(TASK-0114)이 이 위젯을 폼에 붙이면 이 페이지는 사라집니다.',
      storeLabel: '스토어 ID',
      outputTitle: '상품 저장 요청에 실릴 값',
      outputEmpty: '아직 올린 이미지가 없습니다.',
    },
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

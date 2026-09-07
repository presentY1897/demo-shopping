import type { Messages } from './types'

export const ko: Messages = {
  app: {
    name: '관리자 콘솔',
    description: '입점·카테고리·정산을 운영하는 사이트 관리자용 콘솔입니다.',
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
  categories: {
    title: '카테고리 관리',
    description:
      '트리를 편집합니다. 이동과 정렬은 즉시 반영되고, 이름과 슬러그는 저장 버튼을 눌러야 반영됩니다.',
    treeLabel: '카테고리 트리',
    loadingLabel: '카테고리를 불러오는 중입니다.',
    emptyTitle: '아직 카테고리가 없습니다',
    emptyDescription: '첫 카테고리를 추가하면 판매자의 상품 등록 폼에 바로 나타납니다.',
    errorTitle: '카테고리를 불러오지 못했습니다',
    retryLabel: '다시 불러오기',
    keyboardHint:
      '위·아래로 이동, 왼쪽·오른쪽으로 접고 펴기, Enter 로 수정합니다. Alt 를 누른 채 위·아래는 순서를 바꾸고, Alt+왼쪽·오른쪽은 단계를 올리고 내립니다.',
    slugLabel: '슬러그',
    inactiveBadge: '비활성',
    selectionLabel: '선택한 카테고리',
    noSelection: '트리에서 카테고리를 선택하면 여기에 작업이 나타납니다.',
    childCountLabel: '하위',
    actions: {
      addRoot: '최상위 카테고리 추가',
      addChild: '하위 추가',
      edit: '수정',
      moveUp: '위로',
      moveDown: '아래로',
      moveOut: '단계 올리기',
      moveIn: '단계 내리기',
      deactivate: '비활성화',
      activate: '활성화',
      remove: '삭제',
      removeBlocked: '하위 카테고리가 있어 삭제할 수 없습니다. 비활성화만 가능합니다.',
      expandAll: '모두 펼치기',
      collapseAll: '모두 접기',
    },
    form: {
      addRootTitle: '최상위 카테고리 추가',
      addChildTitle: '하위 카테고리 추가',
      editTitle: '카테고리 수정',
      parentLabel: '상위 카테고리',
      rootParent: '최상위',
      nameLabel: '이름',
      namePlaceholder: '예: 아우터',
      slugFieldLabel: '슬러그',
      slugPlaceholder: '예: women-outer',
      slugHint: '주소에 쓰입니다. 영문 소문자·숫자와 하이픈만 쓸 수 있습니다.',
      save: '저장',
      saving: '저장 중',
      cancel: '취소',
      closeLabel: '닫기',
      errors: {
        nameRequired: '이름을 입력해주세요.',
        nameTooLong: '이름은 60자까지 입력할 수 있습니다.',
        slugRequired: '슬러그를 입력해주세요.',
        slugFormat: '영문 소문자와 숫자, 하이픈만 쓸 수 있습니다. 예: women-outer',
      },
    },
    retire: {
      removeTitle: '카테고리를 삭제할까요?',
      removeDescription:
        '삭제해도 번호는 남습니다. 과거 주문과 상품이 가리키던 분류가 다른 카테고리로 바뀌지 않습니다.',
      removeBlockedTitle: '삭제할 수 없습니다',
      removeBlockedDescription:
        '하위 카테고리나 상품이 남아 있으면 삭제할 수 없습니다. 대신 비활성화하면 구매자 화면에서 사라지고 기존 상품의 분류는 유지됩니다.',
      deactivateTitle: '카테고리를 비활성화할까요?',
      deactivateDescription:
        '구매자 화면과 상품 등록 폼에서 사라집니다. 하위 카테고리도 함께 보이지 않게 됩니다.',
      activateTitle: '카테고리를 다시 활성화할까요?',
      activateDescription: '구매자 화면과 상품 등록 폼에 다시 나타납니다.',
      confirmRemove: '삭제',
      confirmDeactivate: '비활성화',
      confirmActivate: '활성화',
      cancel: '취소',
      closeLabel: '닫기',
    },
    conflict: {
      title: '다른 관리자가 먼저 수정했습니다',
      description:
        '이 카테고리는 내가 화면을 연 뒤에 바뀌었습니다. 저장하면 상대의 변경을 덮어씁니다. 무엇을 남길지 선택해주세요.',
      serverLabel: '지금 저장된 값',
      mineLabel: '내가 입력한 값',
      reloadLabel: '최신 내용 불러오기',
      overwriteLabel: '내 입력으로 덮어쓰기',
      cancel: '취소',
      closeLabel: '닫기',
    },
    toast: {
      regionLabel: '알림',
      closeLabel: '알림 닫기',
      moved: '순서를 옮겼습니다.',
      created: '카테고리를 추가했습니다.',
      updated: '카테고리를 수정했습니다.',
      removed: '카테고리를 삭제했습니다.',
      deactivated: '카테고리를 비활성화했습니다.',
      activated: '카테고리를 활성화했습니다.',
      moveFailed: '옮기지 못했습니다',
      saveFailed: '저장하지 못했습니다',
      restored: '원래 위치로 되돌렸습니다.',
    },
    // Only the failures that arrive with no answer to read. Everything the API
    // answers is keyed by `error.code` in `errors` below.
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 속성 관리 (TASK-0031). API 가 답하는 실패는 여기가 아니라 아래 errors 에
  // code 로 들어간다 — 화면마다 한 벌씩 두면 두 벌이 어긋난다.
  attributes: {
    title: '속성 관리',
    description:
      '카테고리를 고르면 그 카테고리의 상품 등록 폼에 나타날 속성이 보입니다. 상위 카테고리에서 물려받은 속성은 물려받은 곳에서 고칩니다.',
    categoryLabel: '카테고리',
    categoryPlaceholder: '카테고리를 선택해주세요',
    categorySeparator: ' › ',
    categoryInactiveSuffix: ' (비활성)',
    loadingLabel: '속성을 불러오는 중입니다.',
    emptyTitle: '이 카테고리에는 아직 속성이 없습니다',
    emptyDescription:
      '속성을 추가하면 판매자의 상품 등록 폼에 바로 나타나고, 하위 카테고리도 함께 물려받습니다.',
    noCategoryTitle: '아직 카테고리가 없습니다',
    noCategoryDescription: '속성은 카테고리에 붙습니다. 카테고리 관리에서 먼저 하나 만들어주세요.',
    errorTitle: '속성을 불러오지 못했습니다',
    retryLabel: '다시 불러오기',
    listLabel: '이 카테고리에 적용되는 속성',
    columns: {
      label: '이름',
      key: '식별자',
      type: '형식',
      required: '필수',
      filterable: '검색 필터',
      source: '정의된 곳',
      actions: '작업',
    },
    typeLabels: {
      TEXT: '자유 입력',
      NUMBER: '숫자',
      SELECT: '하나 선택',
      MULTI_SELECT: '여러 개 선택',
      BOOLEAN: '예 · 아니오',
    },
    typeHints: {
      TEXT: '소재나 원산지처럼 판매자가 직접 적는 값입니다.',
      NUMBER: '무게나 혼용률처럼 숫자로만 적는 값입니다. 단위는 이름에 적어주세요.',
      SELECT: '미리 정해 둔 선택지 중 하나를 고릅니다.',
      MULTI_SELECT: '미리 정해 둔 선택지 중 여러 개를 고릅니다.',
      BOOLEAN: '있다·없다로 답하는 값입니다.',
    },
    inheritedFrom: '{name} 에서 물려받음',
    yes: '예',
    no: '아니오',
    keyHeadingHint: '저장된 상품 값이 이 이름을 쓰기 때문에 만든 뒤에는 바꿀 수 없습니다.',
    actions: {
      add: '속성 추가',
      edit: '수정',
      remove: '삭제',
      moveUp: '위로',
      moveDown: '아래로',
      goToSource: '{name} 에서 수정',
      toggleFilterable: '{label} 을(를) 검색 필터로 노출',
    },
    form: {
      addTitle: '속성 추가',
      editTitle: '속성 수정',
      categoryLabel: '정의할 카테고리',
      keyLabel: '식별자',
      keyPlaceholder: '예: material',
      keyHint: '영문 소문자와 숫자, 밑줄만 쓸 수 있습니다. 상품 데이터에 저장되는 이름입니다.',
      keyLockedHint:
        '이미 저장된 상품이 이 이름으로 값을 들고 있어 바꿀 수 없습니다. 바꾸려면 새 속성을 만들고 이 속성을 삭제해주세요.',
      labelLabel: '이름',
      labelPlaceholder: '예: 소재',
      typeLabel: '형식',
      typePlaceholder: '형식을 선택해주세요',
      typeLockedHint:
        '형식을 바꾸면 이미 저장된 값이 전부 형식에 어긋나게 됩니다. 바꾸려면 새 속성을 만들고 이 속성을 삭제해주세요.',
      optionsLabel: '선택지',
      optionsHint: '판매자가 고를 수 있는 값입니다. 순서대로 보입니다.',
      optionPlaceholder: '예: 블랙',
      optionItemLabel: '{index}번째 선택지',
      optionAddLabel: '선택지 추가',
      optionRemoveLabel: '{index}번째 선택지 삭제',
      requiredLabel: '필수 입력',
      requiredHint: '켜면 이 값을 비운 채로는 상품을 저장할 수 없습니다.',
      filterableLabel: '검색 필터로 노출',
      filterableHint: '켜면 구매자가 이 값으로 상품을 좁혀 볼 수 있습니다.',
      save: '저장',
      saving: '저장 중',
      cancel: '취소',
      closeLabel: '닫기',
      submitError: '저장하지 못했습니다. 입력을 확인한 뒤 다시 시도해주세요.',
      errors: {
        keyRequired: '식별자를 입력해주세요.',
        keyFormat: '영문 소문자로 시작하고 소문자·숫자·밑줄만 쓸 수 있습니다. 예: wool_ratio',
        labelRequired: '이름을 입력해주세요.',
        labelTooLong: '이름은 40자까지 입력할 수 있습니다.',
        typeRequired: '형식을 선택해주세요.',
        optionsRequired: '선택지를 하나 이상 추가해주세요.',
        optionsForbidden: '이 형식은 선택지를 가질 수 없습니다.',
        optionsDuplicate: '같은 선택지를 두 번 넣을 수 없습니다.',
        optionInvalid: '선택지는 1자 이상 40자 이하로 입력해주세요.',
      },
    },
    preview: {
      title: '상품 등록 폼 미리보기',
      description:
        '판매자가 이 카테고리에 상품을 올릴 때 보게 될 폼입니다. 지금 편집 중인 속성도 함께 보입니다.',
      emptyTitle: '아직 물어볼 것이 없습니다',
      emptyDescription: '속성을 추가하면 이 자리에 입력 항목이 나타납니다.',
      draftBadge: '저장 전',
      errors: {
        required: '{label} 을(를) 입력해주세요.',
        invalidNumber: '{label} 은(는) 숫자로 입력해주세요.',
        invalidChoice: '{label} 은(는) 선택지 중에서 골라주세요.',
      },
    },
    retire: {
      title: '속성을 삭제할까요?',
      description:
        '판매자의 상품 등록 폼에서 사라지고, 하위 카테고리에서도 더 이상 물려받지 않습니다. 이미 저장된 상품의 값은 그대로 남습니다.',
      blockedTitle: '삭제할 수 없습니다',
      blockedDescription:
        '이 속성을 쓰고 있는 상품이 있어 삭제할 수 없습니다. 상품에서 값을 먼저 정리해주세요.',
      confirm: '삭제',
      cancel: '취소',
      closeLabel: '닫기',
    },
    conflict: {
      title: '다른 관리자가 먼저 수정했습니다',
      description:
        '이 속성은 내가 화면을 연 뒤에 바뀌었습니다. 저장하면 상대의 변경을 덮어씁니다. 무엇을 남길지 선택해주세요.',
      serverLabel: '지금 저장된 값',
      mineLabel: '내가 입력한 값',
      reloadLabel: '최신 내용 불러오기',
      overwriteLabel: '내 입력으로 덮어쓰기',
      cancel: '취소',
      closeLabel: '닫기',
    },
    toast: {
      regionLabel: '알림',
      closeLabel: '알림 닫기',
      created: '속성을 추가했습니다.',
      updated: '속성을 수정했습니다.',
      removed: '속성을 삭제했습니다.',
      moved: '순서를 바꿨습니다.',
      filterableOn: '검색 필터로 노출합니다.',
      filterableOff: '검색 필터에서 감췄습니다.',
      saveFailed: '저장하지 못했습니다',
      moveFailed: '순서를 바꾸지 못했습니다',
      reloaded: '지금 저장된 순서를 다시 불러왔습니다.',
    },
    // 응답이 오기 전에 끝난 실패만. API 가 답한 것은 전부 아래 errors 에서
    // code 로 찾는다.
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  sellers: {
    title: '입점 심사',
    description: '입점 신청을 확인하고 승인·반려하거나, 영업 중인 스토어를 정지·해제합니다.',
    listLabel: '입점 신청 목록',
    loadingLabel: '신청 목록을 불러오는 중입니다',
    emptyTitle: '아직 들어온 신청이 없어요',
    emptyDescription: '판매자가 입점을 신청하면 여기에 쌓입니다.',
    filteredEmptyTitle: '이 상태인 신청이 없어요',
    filteredEmptyDescription: '다른 상태를 골라보세요.',
    errorTitle: '신청 목록을 불러오지 못했어요',
    retryLabel: '다시 시도',
    filterLabel: '상태',
    filterAll: '전체',
    // 운영자에게 PENDING 을 그대로 보여주지 않는다(D-014).
    statusLabels: {
      PENDING: '심사 대기',
      ACTIVE: '영업 중',
      REJECTED: '반려됨',
      SUSPENDED: '정지됨',
    },
    columns: {
      brandName: '브랜드명',
      slug: '스토어 주소',
      status: '상태',
      appliedAt: '신청일',
      changedAt: '최근 변경',
      reason: '사유',
      actions: '처리',
    },
    emptyValue: '없음',
    pagination: {
      label: '신청 목록 페이지 이동',
      previous: '이전',
      next: '다음',
      pageUnit: '페이지',
      countUnit: '건',
    },
    actions: {
      approve: '승인',
      reject: '반려',
      suspend: '정지',
      reinstate: '정지 해제',
    },
    // 훅이 주는 "이 역할로는 할 수 없는 작업입니다." 뒤에 붙어, 어느 권한이
    // 없는지까지 말한다.
    denials: {
      approve: '승인·반려는 운영자 이상만 할 수 있어요.',
      suspend: '정지·해제는 최고 관리자만 할 수 있어요.',
    },
    demoScopeNotice:
      '데모 관리자는 데모 계정이 만든 신청만 처리할 수 있어요. 실계정 신청은 눌러도 거절됩니다.',
    forbiddenTitle: '입점 심사를 볼 수 없어요',
    detail: {
      backLabel: '목록으로',
      applicationTitle: '신청 내용',
      statusTitle: '현재 상태',
      brandNameLabel: '브랜드명',
      slugLabel: '스토어 주소',
      introductionLabel: '스토어 소개',
      logoLabel: '로고',
      ownerLabel: '신청 계정',
      appliedAtLabel: '신청일',
      statusLabel: '상태',
      reasonLabel: '최근 사유',
      changedAtLabel: '최근 변경 시각',
      loadingLabel: '신청 내용을 불러오는 중입니다',
      notFoundTitle: '신청을 찾을 수 없어요',
      notFoundDescription: '이미 삭제되었거나 주소가 잘못됐어요. 목록에서 다시 찾아보세요.',
      errorTitle: '신청 내용을 불러오지 못했어요',
      logoAlt: '스토어 로고',
      noActions: '이 상태에서 관리자가 할 수 있는 처리가 없어요. 다음은 판매자의 재신청입니다.',
    },
    dialog: {
      titles: {
        approve: '입점을 승인할까요?',
        reject: '입점을 반려할까요?',
        suspend: '스토어를 정지할까요?',
        reinstate: '정지를 해제할까요?',
      },
      descriptions: {
        approve: '승인하면 판매자 콘솔이 열리고 상품을 등록할 수 있게 됩니다.',
        reject: '반려 사유는 판매자에게 그대로 보입니다. 무엇을 고쳐야 하는지 적어주세요.',
        suspend: '정지하면 상품 등록이 막힙니다. 이미 받은 주문의 처리는 계속됩니다.',
        reinstate: '해제하면 다시 상품을 등록하고 판매할 수 있게 됩니다.',
      },
      confirms: {
        approve: '승인하기',
        reject: '반려하기',
        suspend: '정지하기',
        reinstate: '해제하기',
      },
      reasonLabel: '사유',
      reasonHint: '판매자에게 그대로 보입니다. 500자까지 쓸 수 있어요.',
      reasonPlaceholder: '무엇을 고쳐야 하는지 적어주세요.',
      cancel: '취소',
      closeLabel: '닫기',
      submitError: '처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
      errors: {
        reasonRequired: '사유를 입력해 주세요.',
        reasonTooLong: '사유는 500자까지 쓸 수 있어요.',
      },
    },
    toast: {
      regionLabel: '알림',
      closeLabel: '닫기',
      decided: {
        approve: '승인했어요.',
        reject: '반려했어요.',
        suspend: '정지했어요.',
        reinstate: '정지를 해제했어요.',
      },
      failed: '처리하지 못했어요',
      conflict: '다른 관리자가 먼저 처리했어요. 최신 상태를 다시 불러왔어요.',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 클레임 개입 (TASK-0071). 목록·상세·강제 처리·이의 기각·지연 모니터링·실패한
  // 환불이 한 슬라이스에 있다 — 운영자의 머릿속에서 하나의 일이고, 라우트 경계로
  // 쪼갠 문구는 서로 어긋나기 시작한다 (sellers 슬라이스와 같은 이유).
  claims: {
    title: '클레임 관리',
    description:
      '플랫폼 전체의 취소·반품을 조회하고, 판매자의 거절을 뒤집거나 구매자의 이의를 기각합니다.',
    vocabulary: {
      statusLabels: {
        CANCEL_REQUESTED: '취소 신청',
        CANCEL_APPROVED: '취소 승인',
        CANCEL_REJECTED: '취소 거절',
        RETURN_REQUESTED: '반품 신청',
        RETURN_APPROVED: '반품 승인',
        PICKING_UP: '회수 중',
        INSPECTING: '입고 검수',
        RETURN_COMPLETED: '반품 완료',
        RETURN_REJECTED: '반품 거절',
        REFUNDED: '환불 완료',
      },
      typeLabels: {
        CANCEL: '취소',
        RETURN: '반품',
      },
      faultLabels: {
        CUSTOMER: '구매자 귀책',
        SELLER: '판매자 귀책',
      },
      stageLabels: {
        WAITING: '처리 대기',
        IN_PROGRESS: '진행 중',
        CLOSED: '처리 완료',
      },
      returnReasonLabels: {
        CHANGE_OF_MIND: '단순 변심',
        DEFECTIVE: '상품 하자',
        WRONG_ITEM: '오배송',
      },
      actorLabels: {
        BUYER: '구매자',
        SELLER: '판매자',
        ADMIN: '관리자',
        SYSTEM: '자동 처리',
      },
    },
    // 「처리할 수 없다」를 버튼이 아니라 문장으로 말하는 자리 (TASK-0063 4.1).
    // 앞엣것은 무엇을 누르기 전에, 뒤엣것은 서버가 이 한 건에 대해 답한 뒤에 나온다.
    scope: {
      demoNotice:
        '데모 관리자는 플랫폼 전체를 조회하지만, 바꾸는 것은 데모 계정이 만든 건뿐입니다. 실계정이 만든 클레임도 목록에 그대로 보이고, 강제 처리나 이의 기각을 누르면 서버가 거절합니다. 어느 쪽인지는 눌러 보기 전에는 알 수 없어요.',
      outOfScope:
        '이 클레임은 데모 계정이 만든 것이 아니라 처리할 수 없습니다. 조회는 그대로 됩니다 — 실계정의 재고와 돈은 데모 계정이 바꾸지 않습니다.',
    },
    list: {
      tabs: {
        // 넷째 탭은 목록이 아니라 **시작하는 자리**다. 그래서 「무엇을 볼지」가
        // 아니라 「무엇을 할지」다.
        label: '클레임 콘솔에서 할 일 고르기',
        all: '전체',
        overdue: '처리 지연',
        failedRefunds: '환불 실패',
        defectReturn: '확정 후 하자 반품',
        countLabel: '{name} {count}건',
      },
      listLabel: '클레임 목록',
      loadingLabel: '클레임 목록을 불러오는 중입니다',
      errorTitle: '클레임 목록을 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '아직 들어온 클레임이 없어요',
      emptyDescription: '구매자가 취소나 반품을 신청하면 여기에 쌓입니다.',
      filteredEmptyTitle: '이 조건에 맞는 클레임이 없어요',
      filteredEmptyDescription: '조건을 지우거나 다른 조건으로 찾아보세요.',
      columns: {
        orderNumber: '주문번호',
        seller: '판매자',
        buyer: '구매자',
        type: '유형',
        status: '상태',
        stage: '단계',
        items: '대상',
        requestedAt: '신청 시각',
        dueAt: '처리 기한',
        flags: '표시',
        quantity: '{count}개',
      },
      badges: {
        overdue: '기한 초과',
        appealPending: '이의 검토 대기',
        intervention: '관리자 개입',
      },
      // 좁히는 값이 계약에서는 식별자이고 화면에서는 이름이다. 그래서 고르는 자리가
      // 셀렉트가 아니라 목록의 행이다 — 이 콘솔에는 판매자·구매자를 빠짐없이 답하는
      // 엔드포인트가 없고, 첫 페이지만 담은 셀렉트는 조용히 누군가를 빠뜨린다.
      narrow: {
        seller: '{name} 의 클레임만 보기',
        buyer: '구매자 {id} 의 클레임만 보기',
        activeSeller: '판매자: {name}',
        activeBuyer: '구매자: {id}',
        clear: '이 조건 지우기',
      },
      filters: {
        legend: '클레임 좁혀 보기',
        statusLabel: '상태',
        statusAll: '전체 상태',
        stageLabel: '단계',
        stageAll: '전체 단계',
        typeLabel: '유형',
        typeAll: '전체 유형',
        fromLabel: '신청 시작일',
        toLabel: '신청 종료일',
        periodHint: '고른 날의 0시부터 24시까지를 포함합니다. 한국 시간 기준이에요.',
        appealedLabel: '이의 검토 대기만 보기',
        reset: '조건 지우기',
      },
      pagination: {
        label: '클레임 목록 페이지 이동',
        previous: '이전',
        next: '다음',
        pageUnit: '페이지',
        countUnit: '건',
      },
    },
    overdue: {
      title: '처리 지연',
      description: '처리 기한을 넘긴 채 판매자의 다음 걸음을 기다리는 건입니다.',
      listLabel: '처리 지연 클레임 목록',
      loadingLabel: '지연된 클레임을 불러오는 중입니다',
      errorTitle: '지연 목록을 불러오지 못했어요',
      emptyTitle: '기한을 넘긴 클레임이 없어요',
      emptyDescription: '들어온 신청이 모두 기한 안에서 처리되고 있습니다.',
      truncatedNotice:
        '한 번에 훑을 수 있는 양을 넘겼습니다. 여기 보이는 것보다 밀린 건이 더 있어요.',
    },
    failedRefunds: {
      title: '환불 실패',
      description: '승인·검수는 끝났는데 돈이 나가지 못한 건입니다. 구매자는 아직 기다리고 있어요.',
      listLabel: '실패한 환불 목록',
      loadingLabel: '실패한 환불을 불러오는 중입니다',
      errorTitle: '실패한 환불을 불러오지 못했어요',
      emptyTitle: '나가지 못한 환불이 없어요',
      emptyDescription: '승인된 환불이 모두 정상적으로 지급됐습니다.',
      hasMoreNotice: '보이는 것보다 더 많은 환불이 밀려 있습니다. 결제 연동 상태를 확인해주세요.',
      columns: {
        orderNumber: '주문번호',
        seller: '판매자',
        status: '클레임 상태',
        amount: '환불 예정액',
        attempts: '시도',
        lastError: '마지막 실패 이유',
        waitingSince: '기다린 시작 시각',
      },
      attemptCount: '{count}회',
      noAttempt: '아직 시도하지 않음',
      noError: '기록된 실패 이유 없음',
    },
    attention: {
      title: '지금 손봐야 할 클레임',
      description: '기한을 넘긴 건과 나가지 못한 환불입니다. 자세한 것은 클레임 관리에서 봅니다.',
      loadingLabel: '개입이 필요한 건을 불러오는 중입니다',
      errorTitle: '개입이 필요한 건을 불러오지 못했어요',
      overdueCount: '기한 초과 {count}건',
      failedCount: '환불 실패 {count}건',
      allClear: '지금 개입이 필요한 클레임이 없습니다.',
      link: '클레임 관리로',
    },
    detail: {
      backLabel: '목록으로',
      title: '클레임 상세',
      subtitle: '주문번호 {orderNumber}',
      loadingLabel: '클레임을 불러오는 중입니다',
      errorTitle: '클레임을 불러오지 못했어요',
      retryLabel: '다시 시도',
      notFoundTitle: '클레임을 찾을 수 없어요',
      notFoundDescription: '이미 지워졌거나 주소가 잘못됐어요. 목록에서 다시 찾아보세요.',
      sections: {
        actions: '관리자 처리',
        summary: '신청 요약',
        items: '대상 항목',
        request: '신청 사유',
        appeal: '구매자 이의',
        intervention: '개입 관계',
        history: '처리 이력',
      },
      summary: {
        type: '유형',
        status: '상태',
        fault: '귀책',
        requestedBy: '신청 계정',
        requestedAt: '신청 시각',
        updatedAt: '최근 변경',
        orderNumber: '주문번호',
      },
      items: {
        caption: '이 클레임이 걸린 항목',
        product: '상품',
        option: '옵션',
        sku: '품번',
        quantity: '수량',
        noOption: '옵션 없음',
      },
      history: {
        caption: '이 클레임이 지나온 상태',
        at: '시각',
        change: '변화',
        actor: '처리자',
        reason: '사유',
        created: '신청 접수',
        step: '{from} → {to}',
        noReason: '사유 없음',
        empty: '아직 기록된 이력이 없어요.',
      },
      intervention: {
        overturnsTitle: '이 클레임이 뒤집은 거절',
        overturnsBody:
          '관리자가 원본 거절 대신 낸 신청입니다. 원본은 거절된 채 그대로 남아 있어요.',
        openOriginal: '원본 거절 열기',
        overturnedTitle: '이 거절을 뒤집은 개입',
        overturnedBody: '관리자가 다른 결론을 냈습니다. 이 거절 자체는 취소되지 않았어요.',
        openIntervention: '개입 {index} 열기',
        none: '이 클레임에 걸린 관리자 개입이 없습니다.',
      },
      actions: {
        force: '강제 처리',
        dismissAppeal: '이의 기각',
      },
      // 누를 수 없는 버튼을 내는 대신 왜 지금이 아닌지를 말한다. 비활성 버튼은 탭으로
      // 닿지 못하고, aria-disabled 버튼은 닿아도 눌리지 않으면서 사유를 툴팁에 감춘다.
      blocked: {
        title: '지금 할 수 있는 처리가 없어요',
        state: {
          not_concluded:
            '아직 판매자의 결론이 나지 않았습니다. 강제 처리는 거절을 뒤집는 일이라, 판매자가 승인하거나 거절한 뒤에 열립니다.',
          settled:
            '환불까지 끝난 클레임입니다. 구매자가 원한 결과라 뒤집을 것이 없고, 나간 돈을 도로 받는 절차는 이 서비스에 없습니다.',
        },
        permission:
          '강제 처리와 이의 기각에는 클레임 처리 권한이 필요합니다. 조회는 그대로 됩니다.',
        refusedTitle: '이 클레임은 처리할 수 없어요',
      },
      toast: {
        regionLabel: '알림',
        closeLabel: '닫기',
        forced: '거절을 뒤집었어요. 관리자 이름으로 새 클레임이 하나 생겼습니다.',
        dismissed: '이의를 기각했어요. 판매자의 거절이 유지됩니다.',
      },
      failureTitle: '요청을 처리하지 못했어요',
    },
    force: {
      title: '판매자의 거절을 뒤집을까요?',
      description: '거절 대신 관리자의 결론을 새 클레임으로 세웁니다.',
      // 무엇이 일어나는지와 되돌릴 수 없다는 것을 나눠서 말한다. 한 문단이면 안 읽는다.
      consequences: {
        newClaim: '원본 거절은 그대로 남고, 관리자 이름으로 승인된 새 클레임이 하나 생깁니다.',
        money:
          '구매자에게 환불이 시작되고 판매자의 재고가 돌아갑니다. 두 사람의 것이 함께 바뀝니다.',
        appeal: '이 거절에 걸린 이의가 있으면 같은 처리에서 인용으로 닫힙니다.',
        irreversible: '되돌리는 절차는 없습니다. 나간 환불을 다시 받는 길이 이 서비스에는 없어요.',
      },
      itemsLabel: '이 개입이 대상으로 삼는 항목',
      itemsCaption: '원본 신청에서 그대로 가져온 항목과 수량',
      faultLabel: '귀책',
      faultHint: '취소의 귀책을 여기서 다시 판정합니다. 환불액이 이 값으로 갈립니다.',
      returnReasonLabel: '반품 사유',
      returnReasonHint:
        '반품의 귀책은 사유에서 나옵니다. 반품 배송비를 누가 무는지가 함께 정해져요.',
      faultPreview: '{fault} 으로 기록됩니다.',
      amountNotice:
        '환불 금액은 판매자 화면과 같은 계산을 지나 정해집니다. 이 화면에는 금액 미리보기가 아직 없어요.',
      reasonLabel: '개입 사유',
      reasonHint: '이력에 그대로 남고 판매자와 구매자가 함께 봅니다. 500자까지 쓸 수 있어요.',
      reasonPlaceholder: '무엇을 근거로 다른 결론을 냈는지 적어주세요.',
      confirm: '강제 처리하기',
      cancel: '취소',
      closeLabel: '닫기',
      errors: {
        reasonRequired: '개입 사유를 입력해 주세요.',
        reasonTooLong: '개입 사유는 500자까지 쓸 수 있어요.',
      },
    },
    // 확정 후 하자 반품 (F4). 목록의 어느 줄로도 닿을 수 없는 자리라, 문구도
    // 「무엇을 되돌리는가」부터 시작한다 — 구매확정 다이얼로그(`apps/shop`)가 톤의
    // 본보기이고, 한 문단으로 접으면 아무도 읽지 않는다.
    defectReturn: {
      title: '확정 후 하자 반품',
      description:
        '구매확정된 주문을 관리자가 되돌려 반품을 대신 접수합니다. 구매자도 판매자도 이 일을 할 수 없어요.',
      // 무엇이 일어나는지를 나눠서 말한다. 셋째 줄이 이 화면에만 있는 사실이다.
      consequences: {
        reopens:
          '구매확정된 주문이 반품으로 되돌아갑니다. 확정은 구매자에게 끝이고, 그것을 되돌릴 수 있는 것은 관리자뿐입니다.',
        money:
          '관리자 이름으로 승인된 반품이 하나 생깁니다. 수거와 입고 검수를 거쳐 합격하면 구매자에게 환불이 나가고 판매자의 재고가 돌아갑니다.',
        settlement:
          '이 주문의 정산이 이미 나갔다면 그 돈을 판매자에게서 회수해야 합니다. 회수 절차는 아직 없어요(M12) — 지금 누르면 회수해야 할 금액이 하나 생긴다는 뜻입니다.',
        irreversible:
          '되돌리는 절차는 없습니다. 잘못 접수한 반품을 없던 일로 만드는 길이 이 서비스에는 없어요.',
      },
      lookup: {
        legend: '되돌릴 주문 찾기',
        label: '판매자 주문 식별자',
        hint: '주문 하나에 판매자별 몫이 여럿이라, 반품은 그중 한 몫에 걸립니다.',
        placeholder: '019597a0-0008-7000-8000-00000000c001',
        submit: '찾기',
        // **주문번호로 찾을 수 없다는 사실을 화면에 상주시킨다.** 사람이 손에 들고
        // 오는 값이 주문번호인데 그것으로 판매자 몫을 찾는 조회 라우트가 없다.
        // 이 문장이 없으면 운영자는 매번 주문번호를 넣어 보고 실패한다.
        unavailableNotice:
          '주문번호로는 아직 찾을 수 없습니다. 주문번호로 판매자 몫을 찾는 조회 라우트가 없어서(판매자 주문 목록은 부르는 사람의 가게로 좁혀집니다) 지금은 식별자로만 열립니다. 관리자 주문 화면이 열리면 그 목록에서 이 화면으로 오게 됩니다.',
        errors: {
          empty: '판매자 주문 식별자를 입력해 주세요.',
          order_number:
            '주문번호를 넣으셨어요. 지금은 주문번호로 찾을 수 없고, 판매자 주문 식별자가 필요합니다.',
          unrecognised: '판매자 주문 식별자 형식이 아니에요. 36자리 식별자를 붙여넣어 주세요.',
        },
        loadingLabel: '주문을 불러오는 중입니다',
        errorTitle: '주문을 불러오지 못했어요',
        retryLabel: '다시 시도',
        notFoundTitle: '그런 판매자 몫이 없어요',
        notFoundDescription:
          '식별자를 다시 확인해 주세요. 주문 전체의 id 가 아니라 판매자 몫 하나의 id 입니다.',
      },
      // 누를 수 없는 버튼을 내는 대신 왜 여기가 아닌지를 말한다 (TASK-0063 4.1).
      blocked: {
        title: '여기서 시작할 수 없는 주문이에요',
        state: {
          claim_path_open:
            '아직 구매확정 전입니다. 구매자가 직접 취소·반품을 신청하고 판매자가 그것을 처리하는 정상 경로가 열려 있어요 — 관리자가 대신 낼 자리가 아닙니다.',
          in_transit:
            '배송 중입니다. 취소하기엔 이미 떠났고 반품하기엔 아직 도착하지 않았어요. 배송완료 뒤에는 구매자가 직접 신청할 수 있습니다.',
          window_closed:
            '배송완료 뒤 반품 기간이 지났고, 아직 구매확정 전입니다. 이 화면이 하는 일은 확정을 되돌리는 것이라 이 주문은 대상이 아니에요 — 기간이 지난 건의 개입은 아직 이 콘솔에 자리가 없습니다.',
          not_claimable:
            '이 상태의 주문에는 걸 것이 없습니다. 결제 전이거나, 이미 취소·반품으로 끝난 몫이에요.',
          nothing_left:
            '구매확정된 주문이 맞지만 남은 수량이 없습니다. 항목이 전부 다른 클레임에 잡혀 있어요.',
        },
      },
      form: {
        found: '구매확정된 주문입니다. 되돌릴 항목과 수량을 고르세요.',
        itemsLegend: '되돌릴 항목과 수량',
        itemsHint:
          '남은 수량만큼만 고를 수 있습니다. 이미 다른 클레임이 잡고 있는 수량은 빠져 있어요.',
        itemLabel: '{product} · {option}',
        noOption: '옵션 없음',
        remaining: '남은 수량 {count}개',
        quantityLabel: '{product} 수량',
        reasonLabel: '반품 사유',
        // 사유 제한을 **문장으로도** 말한다. 목록에 없는 것만으로는 왜 없는지 모른다.
        reasonHint:
          '단순 변심은 여기 없습니다. 확정을 되돌리는 것은 판매자 귀책일 때만 할 수 있고, 그 판정이 곧 반품 배송비와 원 배송비를 누가 무는지를 정해요.',
        faultPreview: '{fault} 으로 기록됩니다.',
        photosLabel: '증거 사진',
        photosHint:
          '하자·오배송 반품에는 사진이 한 장 이상 필요합니다(최대 {max}장 · 한 장 5MB). 구매자에게 받은 사진을 관리자 계정으로 올리는 자리예요 — 첨부되는 것은 올린 사람의 것으로 기록됩니다.',
        photosDropLabel: '사진을 끌어다 놓거나 파일을 선택하세요',
        photosDropActive: '여기에 놓으세요',
        photosListLabel: '첨부한 사진',
        photoRemove: '{name} 빼기',
        photoStatus: {
          uploading: '올리는 중',
          ready: '첨부됨',
          failed: '실패',
        },
        photoFailures: {
          unsupported_type: 'JPEG · PNG · WebP 만 올릴 수 있어요.',
          too_large: '한 장에 5MB 까지 올릴 수 있어요.',
          too_many: '사진은 최대 {max}장까지예요.',
          storage: '저장소가 업로드를 거절했어요. 잠시 후 다시 올려 주세요.',
        },
        noteLabel: '개입 사유',
        noteHint: '이력에 그대로 남고 판매자와 구매자가 함께 봅니다. 500자까지 쓸 수 있어요.',
        notePlaceholder: '무엇을 확인했고 왜 확정을 되돌리는지 적어주세요.',
        submit: '하자 반품 접수',
        // 눌러 보기 전에는 그리지 않는다. 들어오자마자 「골라주세요」를 보이는 것은
        // 안내가 아니라 아직 하지 않은 일에 대한 지적이다.
        issuesLabel: '아직 남은 것',
        issues: {
          no_items: '되돌릴 항목을 하나 이상 골라주세요.',
          reason_required: '개입 사유를 입력해 주세요.',
          reason_too_long: '개입 사유는 500자까지 쓸 수 있어요.',
          photo_required: '증거 사진을 한 장 이상 첨부해 주세요.',
          photo_uploading: '아직 올라가는 중인 사진이 있어요. 끝나면 보낼 수 있습니다.',
        },
      },
      confirm: {
        title: '구매확정을 되돌릴까요?',
        description: '이 주문의 확정이 되돌아가고, 관리자 이름으로 승인된 반품이 하나 생깁니다.',
        itemsCaption: '이 반품이 대상으로 삼는 항목',
        confirm: '되돌리고 접수하기',
        cancel: '취소',
        closeLabel: '닫기',
      },
      done: {
        title: '하자 반품을 접수했어요',
        body: '관리자 이름으로 승인된 반품이 생겼습니다. 수거와 입고 검수는 이어서 진행해야 해요.',
        open: '접수한 반품 열기',
        again: '다른 주문 찾기',
      },
      failureTitle: '반품을 접수하지 못했어요',
    },
    appeal: {
      pendingTitle: '검토를 기다리는 이의',
      pendingBody:
        '구매자가 이 거절에 이의를 냈습니다. 인용은 곧 강제 처리이고(같은 처리에서 이의가 닫힙니다), 기각은 판매자의 거절을 유지합니다.',
      reviewedTitle: '검토가 끝난 이의',
      none: '이 클레임에 제기된 이의가 없습니다.',
      filedAt: '제기 시각',
      reason: '이의 사유',
      reviewedAt: '검토 시각',
      outcome: '결과',
      outcomes: {
        UPHELD: '인용 — 관리자가 거절을 뒤집었습니다',
        DISMISSED: '기각 — 판매자의 거절이 유지됩니다',
      },
      reviewNote: '기각 사유',
      noNote: '인용에는 별도 사유를 적지 않습니다. 근거는 개입 클레임의 이력에 있어요.',
      dismiss: {
        title: '이의를 기각할까요?',
        description:
          '판매자의 거절이 그대로 유지됩니다. 구매자는 이 사유를 답으로 받게 되므로, 무엇을 확인했는지 적어주세요.',
        reasonLabel: '기각 사유',
        reasonHint: '구매자에게 그대로 보입니다. 500자까지 쓸 수 있어요.',
        reasonPlaceholder: '무엇을 확인했고 왜 거절이 유지되는지 적어주세요.',
        confirm: '기각하기',
        cancel: '취소',
        closeLabel: '닫기',
        errors: {
          reasonRequired: '기각 사유를 입력해 주세요.',
          reasonTooLong: '기각 사유는 500자까지 쓸 수 있어요.',
        },
      },
    },
    forbiddenTitle: '클레임을 볼 수 없어요',
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 플랫폼 부담 쿠폰의 발행자 콘솔 (TASK-0073). 아래 레코드 다섯은 전부
  // @shopping/shared 가 소유한 유니온으로 키가 잡혀 있어, 값이 하나 늘면 여기가
  // typecheck 에서 걸린다 — 문장 없는 상태를 화면이 빈칸으로 그리는 대신이다.
  coupons: {
    title: '플랫폼 쿠폰',
    description: '플랫폼이 부담하는 쿠폰을 발행하고, 발급 현황과 사용 통계를 봅니다.',
    // 이 화면의 존재 이유가 한 문장으로 적히는 자리다. 폼과 목록이 **같은 문장**을
    // 쓰는 이유는 한쪽만 고쳐지는 것을 막기 위해서다.
    burden: {
      badge: '플랫폼 부담',
      listNotice:
        '여기 있는 쿠폰의 할인액은 모두 플랫폼이 부담합니다. 판매자 정산에서는 차감되지 않고, 판매자는 정가 기준으로 정산받습니다.',
      formNotice:
        '지금 발행하는 쿠폰의 할인액은 플랫폼이 부담합니다. 판매자 정산에서 차감되지 않으므로, 아래 예상 비용은 전액 플랫폼의 몫입니다.',
    },
    lifecycleLabels: {
      ENDED: '기간 종료',
      SUSPENDED: '발행 중단',
      SCHEDULED: '시작 전',
      EXHAUSTED: '수량 소진',
      ACTIVE: '발급 중',
    },
    audienceLabels: {
      ALL: '전체 회원',
      DEMO: '체험용',
    },
    discountTypeLabels: {
      FIXED: '정액 할인',
      PERCENT: '정률 할인',
    },
    scopeTypeLabels: {
      ALL: '전체 상품',
      CATEGORY: '카테고리',
      PRODUCT: '지정 상품',
      SELLER: '지정 스토어',
    },
    forbiddenTitle: '플랫폼 쿠폰을 볼 수 있는 권한이 없어요',
    // 데모 관리자가 무엇을 할 수 있는지 (F7 · D-224). 앞엣것은 무엇을 누르기 전에,
    // 뒤엣것은 서버가 이 한 건에 대해 답한 뒤에 나온다 — 클레임 콘솔과 같은 규약이다.
    scope: {
      demoNotice:
        '체험 관리자가 발행한 쿠폰은 체험 계정에만 지급됩니다. 목록에는 실계정 관리자가 낸 쿠폰도 함께 보이지만, 그 쿠폰을 중단하거나 지급하려고 하면 서버가 거절합니다.',
      outOfScope:
        '실계정 관리자가 발행한 쿠폰이라 체험 관리자가 바꿀 수 없습니다. 조회는 그대로 됩니다 — 실계정 회원이 받은 쿠폰은 체험 계정이 건드리지 않습니다.',
    },
    tabs: {
      label: '쿠폰 콘솔에서 할 일 고르기',
      list: '발행한 쿠폰',
      issue: '새 쿠폰 발행',
    },
    list: {
      listLabel: '플랫폼 쿠폰 목록',
      loadingLabel: '쿠폰 목록을 불러오는 중입니다',
      errorTitle: '쿠폰 목록을 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '아직 발행한 쿠폰이 없어요',
      emptyDescription: '「새 쿠폰 발행」에서 첫 쿠폰을 만들면 여기에 쌓입니다.',
      filteredEmptyTitle: '이 상태의 쿠폰이 없어요',
      filteredEmptyDescription: '조건을 지우거나 다른 상태로 찾아보세요.',
      columns: {
        name: '쿠폰',
        burden: '부담·대상',
        discount: '할인',
        period: '기간',
        issued: '발급',
        used: '사용',
        discountTotal: '할인 총액',
        lifecycle: '상태',
        actions: '관리',
      },
      filters: {
        legend: '쿠폰 좁혀 보기',
        lifecycleLabel: '상태',
        lifecycleAll: '전체 상태',
        fromLabel: '기간 시작일',
        toLabel: '기간 종료일',
        // 「시작일이 이 사이」가 아니라 「이 기간에 걸쳐 있던 쿠폰」이다. 그 규칙을
        // 적지 않으면 8월에 시작해 9월까지 가는 쿠폰이 「9월」 조건에 나타나는 것을
        // 사람이 고장으로 읽는다.
        periodHint:
          '고른 기간에 유효기간이 걸쳐 있던 쿠폰을 모두 보여줍니다. 기간 안에 시작한 쿠폰만 고르는 것이 아니에요. 고른 날의 0시부터 종료일 24시까지이고, 한국 시간 기준입니다.',
        reset: '조건 지우기',
      },
      // 이 콘솔이 낸 쿠폰 전체의 누계 (F6). 목록의 조건과 페이지에 흔들리지 않는다.
      totals: {
        title: '전체 누계',
        usedLabel: '사용된 쿠폰',
        discountLabel: '플랫폼이 부담한 할인',
        scopeNote:
          '발행한 모든 플랫폼 쿠폰의 누계입니다. 아래 조건이나 페이지를 바꿔도 이 숫자는 달라지지 않아요.',
      },
      values: {
        ceiling: '최대 {amount}',
        minimum: '{amount} 이상 주문',
        unlimited: '무제한',
        issued: '{issued} / {limit}장',
        issuedUnlimited: '{issued}장 · 무제한',
        used: '{used}장 · {rate}%',
        period: '{from} ~ {until}',
        code: '코드 {code}',
        noCode: '지급 전용',
      },
      actions: {
        suspend: '발행 중단',
        resume: '발행 재개',
        bulkIssue: '일괄 지급',
        suspendedNoIssue:
          '발행을 중단한 동안에는 지급할 수 없어요. 재개하면 남은 수량을 이어서 지급할 수 있습니다.',
        // 회색 버튼 대신 문장을 세운다 (TASK-0063 4.1). 발급된 장은 그대로 유효하다.
        ended:
          '기간이 끝난 쿠폰이라 더 지급할 수 없어요. 이미 발급된 쿠폰은 만료일까지 그대로 쓸 수 있습니다.',
      },
      pagination: {
        label: '쿠폰 목록 페이지 이동',
        previous: '이전',
        next: '다음',
        pageUnit: '페이지',
        countUnit: '건',
      },
    },
    form: {
      title: '새 쿠폰 발행',
      description: '유형과 값, 조건과 기간, 수량을 정합니다. 발행한 뒤에는 중단만 할 수 있어요.',
      nameLabel: '쿠폰 이름',
      namePlaceholder: '예) 가을맞이 10% 할인',
      discountTypeLabel: '할인 유형',
      discountValueLabel: '할인 값',
      discountValueLabels: {
        FIXED: '할인 금액 (원)',
        PERCENT: '할인율 (%)',
      },
      discountValueHints: {
        FIXED: '주문 금액에서 이 금액만큼 깎입니다.',
        PERCENT: '주문 금액의 이 비율만큼 깎입니다. 1~100 사이로 입력해 주세요.',
      },
      maxDiscountLabel: '최대 할인 금액 (원)',
      // 예상 비용을 계산할 수 있게 만드는 칸이라, 힌트가 그 사실을 말한다.
      maxDiscountHint:
        '정률 쿠폰에만 씁니다. 비워 두면 한 장이 깎을 수 있는 금액에 위가 없어 예상 비용을 계산할 수 없어요.',
      minOrderLabel: '최소 주문 금액 (원)',
      minOrderHint: '이 금액 이상일 때만 쓸 수 있습니다. 조건이 없으면 0으로 둡니다.',
      scopeTypeLabel: '적용 범위',
      categoryLabel: '적용 카테고리',
      categoryPlaceholder: '카테고리를 선택하세요',
      categorySeparator: ' › ',
      categoryLoading: '카테고리를 불러오는 중입니다',
      scopeUnsupported:
        '지정 상품·지정 스토어 범위는 이 화면에서 고를 수 없습니다. 관리자 콘솔에는 상품과 스토어를 빠짐없이 답하는 목록이 아직 없어, 반쪽짜리 선택지를 내는 대신 비워 두었습니다.',
      validFromLabel: '발급 시작일',
      validUntilLabel: '발급 종료일',
      periodHint: '고른 날의 0시부터 종료일 24시까지입니다. 한국 시간 기준이에요.',
      issueLimitLabel: '발급 수량 (장)',
      issueLimitHint:
        '준비한 수량입니다. 비워 두면 무제한이 되고, 그때는 예상 비용을 계산할 수 없어요.',
      withCodeLabel: '쿠폰 코드 발급',
      withCodeHint:
        '코드를 만들면 회원이 직접 입력해 받을 수 있습니다. 코드는 서버가 만들어 발행 뒤에 목록에 나타납니다.',
      submit: '이 내용으로 발행',
      submitting: '발행하는 중',
      submitError: '쿠폰을 발행하지 못했어요. 입력한 내용을 다시 확인해 주세요.',
      cost: {
        title: '예상 비용',
        incomplete: '할인 유형과 값을 채우면 예상 비용을 계산합니다.',
        perCouponLabel: '한 장당 최대',
        totalLabel: '전체 최대',
        formula: '{count}장 × {amount}',
        caveat:
          '받은 사람이 모두 쓰고 모두 상한까지 깎였을 때의 금액입니다. 실제 비용은 이보다 작습니다.',
        unboundedTitle: '예상 비용을 계산할 수 없어요',
        gaps: {
          no_ceiling:
            '정률 쿠폰에 최대 할인 금액이 없습니다. 한 장이 깎는 금액이 주문 금액에 따라 얼마든지 커질 수 있어요.',
          no_limit: '발급 수량이 무제한입니다. 몇 장이 나갈지 정해지지 않아 합계를 낼 수 없어요.',
        },
      },
      confirm: {
        title: '이 쿠폰을 발행할까요?',
        description:
          '발행하면 회원이 받을 수 있게 되고, 발급된 쿠폰은 되돌릴 수 없습니다. 조건이 틀렸다면 발행을 중단하고 새로 내야 해요.',
        confirm: '발행',
        cancel: '다시 볼게요',
        closeLabel: '닫기',
      },
      errors: {
        nameRequired: '쿠폰 이름을 입력해 주세요.',
        nameTooLong: '쿠폰 이름은 {max}자까지 쓸 수 있어요.',
        discountTypeRequired: '할인 유형을 골라 주세요.',
        discountValueRequired: '할인 값을 1 이상의 정수로 입력해 주세요.',
        percentOutOfRange: '할인율은 1~100 사이로 입력해 주세요.',
        amountOutOfRange: '할인 금액은 1원 이상 {max}원 이하로 입력해 주세요.',
        minOrderInvalid: '최소 주문 금액은 0 이상의 정수로 입력해 주세요.',
        issueLimitInvalid: '발급 수량은 1장 이상 {max}장 이하로 입력하거나 비워 주세요.',
        periodRequired: '발급 기간을 정해 주세요.',
        periodInverted: '종료일은 시작일과 같거나 뒤여야 해요.',
        categoryRequired: '적용할 카테고리를 골라 주세요.',
      },
    },
    bulk: {
      title: '한꺼번에 지급',
      description:
        '조건에 맞는 회원에게 쿠폰을 지급합니다. 이미 이 쿠폰을 가진 회원은 건너뛰므로, 두 번 눌러도 한 사람에게 두 장이 가지 않습니다.',
      targetLabel: '지급 대상',
      targetLabels: {
        ALL: '전체 회원',
        HAS_ORDERED: '주문한 적 있는 회원',
        NEVER_ORDERED: '아직 주문하지 않은 회원',
      },
      targetHints: {
        ALL: '체험용 쿠폰은 체험 계정에만 지급됩니다.',
        HAS_ORDERED: '다시 찾아오게 하려는 지급입니다.',
        NEVER_ORDERED: '첫 주문을 만들려는 지급입니다.',
      },
      confirm: '지급',
      submitting: '지급하는 중',
      cancel: '취소',
      close: '닫기',
      // × 단추와 아래의 「닫기」가 같은 일을 한다. 이름까지 같으면 화면을 소리로 듣는
      // 사람에게 「닫기 버튼」이 두 번 들리고, 그중 어느 것을 눌러야 하는지 알 수 없다.
      closeLabel: '창 닫기',
      resultTitle: '지급 결과',
      // 「0장 나갔습니다」가 세 가지 서로 다른 일이라 문장이 넷이다. 뒤의 셋에
      // 발행자가 할 일이 전부 다르다 — 아무것도 안 해도 되는 일, 새 쿠폰을 내는 일,
      // 대상을 바꾸는 일.
      outcomes: {
        issued: '{count}명에게 지급했어요.',
        all_held:
          '조건에 맞는 회원 {count}명이 이미 이 쿠폰을 갖고 있어요. 새로 나간 쿠폰은 없습니다.',
        quantity_gone:
          '준비한 수량이 다 차서 한 장도 나가지 않았어요. 더 지급하려면 쿠폰을 새로 발행해야 합니다.',
        nobody: '조건에 맞는 회원이 없어요. 다른 대상을 골라 보세요.',
      },
      skipped: '이미 이 쿠폰을 가진 {count}명은 건너뛰었어요.',
      // 숫자를 적지 않는다 — 서버가 세어 주는 것은 「남았는가」이지 「몇 명인가」가 아니다.
      remaining:
        '한 번에 지급할 수 있는 수를 넘어 아직 대상이 남았습니다. 다시 누르면 이어서 지급합니다. 준비한 수량이 다 찼다면 더 나가지 않아요.',
    },
    toast: {
      regionLabel: '쿠폰 알림',
      closeLabel: '닫기',
      created: "'{name}' 쿠폰을 발행했어요.",
      suspended: '발행을 중단했어요. 이미 발급된 쿠폰은 그대로 쓸 수 있습니다.',
      resumed: '발행을 다시 시작했어요.',
      failedTitle: '처리하지 못했어요',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 수수료율 설정 (TASK-0079). 아래 `scopeLabels` 는 @shopping/shared 가 소유한
  // 유니온으로 키가 잡혀 있어, 범위가 하나 늘면 여기가 typecheck 에서 걸린다.
  commissions: {
    title: '수수료 설정',
    description: '플랫폼이 떼는 수수료율을 전역·카테고리별·판매자별로 정합니다.',
    forbiddenTitle: '수수료율을 볼 수 없어요',
    scopeLabels: {
      global: '전역',
      category: '카테고리별',
      seller: '판매자별',
    },
    open: {
      title: '지금 적용되는 요율',
      loadingLabel: '요율을 불러오는 중',
      errorTitle: '요율을 불러오지 못했어요',
      retryLabel: '다시 시도',
      // 목록의 순서가 곧 우선순위다. 그 사실을 적지 않으면, 세 요율이 동시에 걸린
      // 스토어에서 어느 것이 적용되는지를 화면이 말하지 않는 셈이 된다.
      priorityNotice:
        '좁은 범위가 넓은 범위를 이깁니다. 판매자 개별 요율 → 카테고리 요율 → 전역 요율 순으로 찾아 처음 만나는 요율이 적용됩니다.',
      globalTitle: '전역 요율',
      // 「0%」가 아니라 이 문장이다. 설정을 안 한 것과 안 받기로 한 것은 다르다.
      globalUnset: '아직 정하지 않았습니다. 지금은 기본 요율 {rate}가 적용됩니다.',
      categoryTitle: '카테고리 요율',
      categoryEmpty: '따로 정한 카테고리가 없습니다. 모두 전역 요율을 씁니다.',
      sellerTitle: '판매자 개별 요율',
      sellerEmpty: '개별 요율을 받는 판매자가 없습니다.',
      categoryListLabel: '카테고리별 수수료율',
      sellerListLabel: '판매자별 수수료율',
      columns: {
        target: '대상',
        rate: '요율',
        since: '적용 시작',
        changedBy: '바꾼 사람',
      },
      categorySeparator: ' › ',
      // 이름을 못 찾아도 빈칸으로 두지 않는다 — 어디에 걸린 요율인지 모르면 고칠
      // 수도 없다.
      unknownTarget: '이름을 찾지 못함 ({id})',
    },
    editor: {
      title: '요율 바꾸기',
      description: '범위를 고르고 새 요율을 적으면, 저장하기 전에 영향을 먼저 보여 드립니다.',
      scopeLabel: '어디에 걸까요',
      categoryLabel: '카테고리',
      categoryPlaceholder: '카테고리를 고르세요',
      categoryLoading: '카테고리를 불러오는 중입니다.',
      sellerLabel: '판매자',
      sellerPlaceholder: '판매자를 고르세요',
      sellerLoading: '판매자를 불러오는 중입니다.',
      sellerUnavailable:
        '판매자 목록을 불러오지 못했습니다. 전역 요율과 카테고리 요율은 그대로 바꿀 수 있어요.',
      // 반쪽짜리 목록을 말없이 내면, 거기 없는 스토어를 고르려던 사람은 그 스토어가
      // 없다고 읽는다.
      sellerNotice:
        '최근 신청한 순으로 100곳까지만 목록에 오릅니다. 관리자 콘솔에 스토어를 이름으로 찾는 화면이 아직 없습니다.',
      currentLabel: '지금 요율 {rate}',
      currentUnset: '이 범위에는 아직 요율이 없습니다. 지금은 기본 요율 {rate}가 적용됩니다.',
      rateLabel: '새 요율 (%)',
      rateHint: '퍼센트로 적습니다. 소수점 아래 둘째 자리까지 쓸 수 있어요. (예: 3.5)',
      ratePlaceholder: '3.5',
      submit: '요율 저장',
      submitting: '저장하는 중',
      submitError: '요율을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.',
      confirm: {
        title: '요율을 바꿀까요',
        // 이미 팔린 것에는 소급되지 않는다는 사실이 여기 있어야 한다 — 그것을
        // 모르면 「과거 정산이 다시 계산되나」를 누르기 전에 알 수 없다.
        description:
          '{scope} 요율을 {rate}로 바꿉니다. 이미 판매된 주문의 수수료는 그대로이고, 이 요율은 지금부터 들어오는 주문에 적용됩니다.',
        confirm: '바꾸기',
        cancel: '취소',
        closeLabel: '창 닫기',
      },
      errors: {
        categoryRequired: '카테고리를 골라 주세요.',
        sellerRequired: '판매자를 골라 주세요.',
        rate: {
          required: '새 요율을 적어 주세요.',
          malformed: '숫자로 적어 주세요. (예: 3.5)',
          too_precise: '소수점 아래 둘째 자리까지만 쓸 수 있어요. (예: 3.55)',
          out_of_range: '0%에서 100% 사이로 적어 주세요.',
        },
      },
    },
    simulation: {
      title: '바꾸면 얼마가 달라질까요',
      idle: '범위를 고르고 새 요율을 적으면 영향을 계산합니다.',
      loadingLabel: '영향을 계산하는 중',
      errorTitle: '영향을 계산하지 못했어요',
      summary: '지난 {days}일 판매 {sales} · 지금 요율이면 {current} · 새 요율이면 {proposed}',
      orderCount: '주문 {count}건을 돌아봤습니다.',
      // 「0원 → 0원」은 「영향이 없다」로 읽힌다. 실제로는 「비교할 근거가 없다」다.
      nothingTitle: '비교할 판매가 없어요',
      nothingDescription:
        '지난 {days}일 동안 이 범위에서 팔린 주문이 없어 얼마나 달라질지 계산할 수 없습니다. 요율은 그대로 바꿀 수 있어요.',
      caveat:
        '지난 {days}일의 실제 판매에 새 요율을 적용해 본 값입니다. 앞으로의 판매를 예측한 값이 아닙니다.',
    },
    history: {
      title: '변경 이력',
      description: '고른 범위가 지나온 요율입니다. 최근 것이 위에 옵니다.',
      idle: '범위를 고르면 그 범위의 이력이 나옵니다.',
      loadingLabel: '이력을 불러오는 중',
      errorTitle: '이력을 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '아직 바꾼 적이 없어요',
      emptyDescription: '이 범위의 요율을 처음 정하면 여기에 남습니다.',
      listLabel: '수수료율 변경 이력',
      columns: {
        changedAt: '바뀐 시각',
        change: '변경',
        changedBy: '바꾼 사람',
      },
      change: '{from} → {to}',
      firstChange: '처음 설정 · {to}',
    },
    toast: {
      regionLabel: '수수료 알림',
      closeLabel: '닫기',
      saved: '{scope} 요율을 {rate}로 바꿨어요.',
      failedTitle: '요율을 바꾸지 못했어요',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 정산 승인·지급 (TASK-0081). 목록과 상세가 한 조각을 나눠 쓰는 이유는
  // types.ts 의 SettlementMessages 주석에 있다 — 상태 이름과 항목 유형을 두 벌
  // 두면 목록의 「보류」와 상세의 「보류」가 언젠가 다른 말이 된다.
  settlements: {
    title: '정산 관리',
    description: '회차별 정산서를 검토하고 승인·보류·지급 처리합니다.',
    forbiddenTitle: '정산서를 볼 수 없어요',
    statusLabels: {
      PENDING: '승인 대기',
      HOLD: '보류',
      APPROVED: '승인됨',
      PAID: '지급완료',
    },
    // 차감 줄은 지난 회차의 되돌림이라 이번 회차의 판매와 성질이 다르다. 이름이
    // 그 차이를 먼저 말하고, 음수 금액이 그것을 확인해 준다.
    itemTypeLabels: {
      SALE: '판매',
      RETURN_ADJUSTMENT: '반품 차감',
    },
    list: {
      loadingLabel: '정산서를 불러오는 중',
      errorTitle: '정산서를 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '아직 정산서가 없어요',
      emptyDescription:
        '정산 배치가 매주 월요일에 지난주 회차를 만듭니다. 구매확정된 주문이 있어야 정산서가 생깁니다.',
      filteredEmptyTitle: '이 조건에 맞는 정산서가 없어요',
      filteredEmptyDescription: '회차나 상태를 바꾸거나, 조건을 지우고 전체를 보세요.',
      listLabel: '정산서 목록',
      columns: {
        select: '선택',
        period: '회차',
        brandName: '판매자',
        status: '상태',
        salesAmount: '판매액',
        payoutAmount: '지급액',
        holdReason: '보류 사유',
        open: '상세',
      },
      period: '{start} ~ {end}',
      selectRow: '{brand} 정산서 선택',
      selectPage: '이 페이지에서 승인할 수 있는 정산서 모두 선택',
      notSelectable: '지금 상태에서는 승인할 수 없어요',
      openLabel: '내역 보기',
      filters: {
        legend: '정산서 검색 조건',
        dayLabel: '회차',
        // 계약의 periodStart 는 구간이 아니라 한 순간이고 회차는 월요일 자정에
        // 시작한다. 고른 날을 그대로 보내면 아무것도 안 걸리므로 화면이 접는다.
        dayHint: '아무 날이나 고르면 그 날이 속한 주(월요일 시작)의 회차를 봅니다.',
        resolved: '이 회차를 봅니다 · {period}',
        statusLabel: '상태',
        statusAll: '전체',
        reset: '조건 지우기',
      },
      narrow: {
        activeSeller: '{name}만 보는 중',
        clear: '해제',
      },
      totals: {
        title: '이 조건의 지급 예정 총액',
        payoutLabel: '지급액 합계',
        countLabel: '정산서',
        countValue: '{count}건',
        // 이 한 줄이 없으면 스무 줄짜리 표 위의 200건 합계가 틀린 숫자로 보인다.
        scopeNotice: '지금 화면의 한 페이지가 아니라 위 조건에 해당하는 정산서 전부의 합입니다.',
      },
      pagination: {
        label: '정산서 페이지 이동',
        next: '다음',
        previous: '이전',
        pageUnit: '페이지',
        countUnit: '건',
      },
    },
    detail: {
      backLabel: '정산서 목록으로',
      title: '정산서',
      subtitle: '{brand} · {period}',
      loadingLabel: '정산서를 불러오는 중',
      errorTitle: '정산서를 불러오지 못했어요',
      retryLabel: '다시 시도',
      notFoundTitle: '정산서를 찾을 수 없어요',
      notFoundDescription: '지워졌거나 주소가 잘못됐습니다. 목록에서 다시 찾아 주세요.',
      sections: {
        actions: '처리',
        summary: '요약',
        calculation: '계산 근거',
        items: '항목별 내역',
      },
      summary: {
        brandName: '판매자',
        period: '회차',
        status: '상태',
        createdAt: '정산서 생성',
        heldAt: '보류',
        approvedAt: '승인',
        paidAt: '지급 확정',
        holdReason: '보류 사유',
        none: '—',
      },
      calculation: {
        caption: '지급액 계산 근거',
        // 빼기 기호가 줄 이름에 있다. 금액의 부호는 Intl 이 그리고, 이름은
        // 무엇을 빼는 중인지를 말한다.
        lines: {
          sales: '판매액',
          commission: '− 플랫폼 수수료',
          sellerCoupon: '− 판매자 부담 쿠폰',
          returnAdjustment: '− 반품 차감',
          payout: '지급액',
        },
        note: '판매액은 정가 기준이며 플랫폼 부담 쿠폰과 적립금은 빼지 않습니다. 지급액은 서버가 계산해 저장한 값이고, 위 네 줄은 그 근거입니다.',
      },
      items: {
        caption: '정산 항목',
        empty: '이 회차에 정산된 항목이 없습니다.',
        columns: {
          type: '유형',
          orderNumber: '주문번호',
          salesAmount: '판매액',
          commissionAmount: '수수료',
          sellerCouponAmount: '판매자 쿠폰',
          payoutAmount: '지급액',
        },
        openOrder: '{orderNumber} 주문 열기',
        openOrderHint: '주문 관리 화면은 준비 중입니다. 주문번호로 바로 찾아갈 수 있게 됩니다.',
        adjustmentNotice:
          '반품 차감 줄은 이미 승인·지급된 지난 회차의 판매를 되돌린 것이라 금액이 음수입니다.',
      },
    },
    actions: {
      labels: {
        approve: '승인',
        hold: '보류',
        pay: '지급 확정',
      },
      locked: {
        title: '더 처리할 것이 없어요',
        // 권한 문제가 아니라 이 정산서의 성질이다. 「권한이 없어요」로 말할 수 없다.
        description:
          '지급이 끝난 정산서는 되돌리거나 고칠 수 없습니다. 금액이 틀렸다면 다음 회차에서 조정합니다.',
      },
      failedTitle: '처리하지 못했어요',
      confirm: {
        approve: {
          title: '이 정산서를 승인할까요',
          description:
            '{brand}의 {period} 회차를 승인합니다. 지급액은 {amount}이고, 승인한 뒤에는 배치가 이 회차의 금액을 더 이상 고치지 않습니다.',
          confirm: '승인',
          cancel: '취소',
          closeLabel: '창 닫기',
        },
        pay: {
          title: '지급을 확정할까요',
          // R1. 금액이 여기 다시 적힌다 — 되돌리는 화살표가 없기 때문이다.
          description:
            '{brand}의 {period} 회차에 {amount}을 지급한 것으로 기록합니다. 되돌릴 수 없고, 오류는 다음 회차에서 조정해야 합니다.',
          confirm: '지급 확정',
          cancel: '취소',
          closeLabel: '창 닫기',
        },
      },
      hold: {
        title: '정산을 보류할까요',
        description:
          '분쟁이나 이상 건일 때 판단을 미룹니다. 사유는 해소된 뒤에도 남고, 판매자가 물었을 때 답하는 근거가 됩니다.',
        reasonLabel: '보류 사유',
        reasonHint:
          '무엇을 확인해야 하는지 적어 주세요. 나중에 읽는 사람이 이 문장 하나로 판단합니다.',
        reasonPlaceholder: '예: 반품 분쟁 확인 중 (클레임 3건)',
        submit: '보류',
        submitting: '보류하는 중',
        cancel: '취소',
        closeLabel: '창 닫기',
        submitError: '보류하지 못했어요. 잠시 후 다시 시도해 주세요.',
        errors: {
          required: '보류 사유를 적어 주세요.',
          tooLong: '{max}자까지 쓸 수 있어요.',
        },
      },
    },
    bulk: {
      selected: '{count}건 선택',
      approve: '선택 승인',
      approving: '승인하는 중',
      clear: '선택 해제',
      tooMany: '한 번에 {max}건까지 승인할 수 있어요. 선택을 줄여 주세요.',
      confirm: {
        title: '선택한 정산서를 승인할까요',
        description:
          '{count}건을 승인합니다. 지급 예정 합계는 {amount}이고, 승인한 뒤에는 배치가 이 회차들의 금액을 더 이상 고치지 않습니다.',
        confirm: '승인',
        cancel: '취소',
        closeLabel: '창 닫기',
      },
      result: {
        title: '일괄 승인 결과',
        approved: '{count}건을 승인했습니다.',
        failedTitle: '승인하지 못한 정산서',
        // 실패를 조용히 빼면 남은 건은 아무도 다시 보지 않는다. 그 건들이야말로
        // 사람이 봐야 하는 것들이다.
        failedDescription: '아래 정산서는 승인되지 않았습니다. 하나씩 열어 확인해 주세요.',
        reasons: {
          not_found: '정산서를 찾을 수 없습니다.',
          wrong_status: '그 사이 상태가 바뀌어 승인할 수 없습니다.',
        },
        listLabel: '승인하지 못한 정산서 목록',
        columns: {
          settlement: '정산서',
          reason: '이유',
        },
        open: '열기',
        dismiss: '닫기',
      },
    },
    export: {
      label: 'CSV 내보내기',
      exporting: '내보내는 중',
      empty: '내보낼 정산서가 없어요.',
      done: '{count}건을 내보냈습니다.',
      filePrefix: 'settlements',
      note: '지금 조건에 해당하는 정산서 전부를 받습니다. 화면의 한 페이지가 아닙니다.',
      columns: {
        periodStart: '회차 시작',
        periodEnd: '회차 종료',
        brandName: '판매자',
        status: '상태',
        salesAmount: '판매액',
        commissionAmount: '수수료',
        sellerCouponAmount: '판매자 쿠폰',
        returnAdjustmentAmount: '반품 차감',
        payoutAmount: '지급액',
        holdReason: '보류 사유',
      },
      // 빈칸이다. 대시를 넣으면 스프레드시트에서 그것이 정렬·필터에 걸리는 값이
      // 된다 (types.ts 의 같은 이름 참조).
      emptyHoldReason: '',
    },
    toast: {
      regionLabel: '정산 알림',
      closeLabel: '닫기',
      approved: '정산서를 승인했어요.',
      held: '정산서를 보류했어요.',
      paid: '지급을 확정했어요.',
      bulkApproved: '{count}건을 승인했어요.',
      exported: '정산서를 내보냈어요.',
      failedTitle: '정산서를 처리하지 못했어요',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 신고 처리 (TASK-0091). 이 화면에서 가장 조심스러운 문구는 **반려**다 —
  // 「아무 일도 안 함」처럼 들리지만 실제로는 자동 임시 숨김을 **푸는** 처리이고,
  // 그 사실이 문구에 없으면 운영자는 반려를 「무시」로 읽는다 (4.2). 그래서 처리
  // 선택지마다 「대상에 무슨 일이 일어나는가」가 한 줄씩 붙는다.
  reports: {
    title: '신고 처리',
    description:
      '리뷰·문의·답변·상품에 들어온 신고를 검토하고 숨김·삭제·반려로 처리합니다. 처리 사유는 신고한 사람에게 그대로 전달됩니다.',
    forbiddenTitle: '신고를 볼 수 없어요',
    statusLabels: {
      PENDING: '처리 대기',
      HIDDEN: '숨김',
      REMOVED: '삭제',
      REJECTED: '반려',
    },
    targetTypeLabels: {
      REVIEW: '리뷰',
      QUESTION: '문의',
      ANSWER: '답변',
      PRODUCT: '상품',
    },
    reasonLabels: {
      ABUSE: '욕설·비방',
      SPAM: '스팸·광고',
      FALSE_INFO: '허위 정보',
      PRIVACY: '개인정보 노출',
      OTHER: '기타',
    },
    list: {
      loadingLabel: '신고를 불러오는 중',
      errorTitle: '신고를 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '아직 들어온 신고가 없어요',
      emptyDescription: '리뷰·문의·답변·상품이 신고되면 여기에 쌓입니다.',
      filteredEmptyTitle: '이 조건에 맞는 신고가 없어요',
      filteredEmptyDescription: '상태나 대상 유형을 바꾸거나 조건을 지워 보세요.',
      listLabel: '신고 목록',
      columns: {
        createdAt: '신고 시각',
        target: '대상',
        reason: '사유',
        status: '상태',
        excerpt: '신고된 내용',
        handle: '처리',
      },
      scopeLabels: {
        PENDING: '처리 대기',
        HANDLED: '처리됨',
        HIDDEN: '숨김',
        REMOVED: '삭제',
        REJECTED: '반려',
      },
      filters: {
        legend: '신고 검색 조건',
        scopeLabel: '상태',
        scopeAll: '전체',
        targetLabel: '대상 유형',
        targetAll: '전체',
        reset: '조건 지우기',
      },
      pending: {
        title: '처리 대기',
        countValue: '{count}건',
        // 이 한 줄이 없으면 「반려」만 보고 있는 화면 위의 숫자가 틀려 보인다.
        scopeNotice: '지금 고른 조건과 무관하게, 아직 처리하지 않은 신고 전체의 건수입니다.',
        only: '대기 건만 보기',
        none: '처리를 기다리는 신고가 없습니다.',
      },
      // 다섯 번째 신고와 첫 신고는 같은 내용이어도 다른 무게를 갖는다.
      reportCount: '신고 {count}번째',
      targetHidden: '가려짐',
      excerptEmpty: '내용을 읽을 수 없습니다.',
      handleLabel: '처리하기',
      handledAt: '처리 {datetime}',
      handledNote: '사유: {note}',
      pagination: {
        label: '신고 목록 페이지',
        next: '다음',
        previous: '이전',
        pageUnit: ' 페이지',
        countUnit: '건',
      },
    },
    handle: {
      title: '신고 처리',
      description: '무엇으로 처리할지 고르고, 신고한 사람에게 갈 사유를 적어 주세요.',
      closeLabel: '창 닫기',
      cancel: '취소',
      submit: '처리하기',
      submitting: '처리하는 중',
      summary: {
        target: '대상',
        reason: '신고 사유',
        detail: '신고자가 적은 내용',
        excerpt: '신고된 내용',
        reportCount: '이 대상의 신고 수',
        createdAt: '신고 시각',
        none: '—',
      },
      hiddenNotice:
        '이 대상은 지금 가려져 있습니다. 신고가 여러 건 모여 자동으로 임시 숨김이 걸린 것일 수 있고, 반려하면 다시 보이게 됩니다.',
      siblingNotice: '같은 대상에 대기 중인 다른 신고도 이 판단으로 함께 닫힙니다.',
      productNotice:
        '상품은 지울 수 없습니다. 주문·정산·리뷰가 가리키는 기록이라, 문제가 있는 상품에는 판매를 멈추는 숨김으로 답합니다.',
      outcomeLegend: '어떻게 처리할까요',
      outcomeLabels: {
        HIDDEN: '숨김',
        REMOVED: '삭제',
        REJECTED: '반려',
      },
      // 셋 중 reveal 이 가장 중요하다 — 「반려」가 아무 일도 안 하는 것으로 읽히면
      // 자동 임시 숨김이 걸린 멀쩡한 글이 영영 가려진 채 남는다.
      outcomeEffects: {
        hide: '대상을 가립니다. 구매자 화면에서 보이지 않고, 쓴 사람에게는 가려졌다는 표시와 함께 남습니다.',
        remove: '대상을 지웁니다. 되돌릴 수 없습니다.',
        reveal: '신고가 잘못됐다고 판단합니다. 자동 임시 숨김이 풀리고 대상이 다시 보이게 됩니다.',
      },
      noteLabel: '처리 사유',
      noteHint: '신고한 사람에게 이 문장이 그대로 전달됩니다. 왜 그렇게 판단했는지 적어 주세요.',
      notePlaceholder: '예) 상품 사용 후기의 범위를 벗어나지 않아 그대로 두었습니다.',
      confirm: {
        title: '정말 삭제할까요',
        description: '{target} 하나를 지웁니다. 되돌릴 수 없습니다.',
        confirm: '삭제',
        back: '뒤로',
        noteLabel: '신고자에게 갈 사유',
      },
      failedTitle: '신고를 처리하지 못했어요',
      refusals: {
        // F7. 목록은 읽히지만 어느 줄이 막히는지는 미리 알 수 없다 — 대상의 주인이
        // 누구인지가 목록에 실려 오지 않는다.
        forbidden:
          '이 계정으로는 이 내용을 처리할 수 없어요. 데모 관리자는 체험 계정이 만든 내용만 가리거나 지울 수 있습니다.',
        stale: '다른 관리자가 먼저 처리했어요. 목록을 새로고침한 뒤 다시 확인해 주세요.',
      },
      refreshLabel: '목록 새로고침',
      submitError: '신고를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
      errors: {
        outcomeRequired: '어떻게 처리할지 골라 주세요.',
        noteRequired: '처리 사유를 적어 주세요. 신고한 사람에게 그대로 전달됩니다.',
        noteTooLong: '사유는 {max}자까지 쓸 수 있어요.',
      },
    },
    toast: {
      regionLabel: '알림',
      closeLabel: '닫기',
      handled: {
        HIDDEN: '대상을 가렸어요.',
        REMOVED: '대상을 지웠어요.',
        REJECTED: '신고를 반려했어요. 대상이 다시 보입니다.',
      },
      failedTitle: '신고를 처리하지 못했어요',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 알림함 (TASK-0090). 상단바의 종과 /notifications 가 같은 문장을 읽는다 —
  // 드롭다운은 안 읽은 다섯 개를 30초마다 다시 묻고, 페이지는 전부를 넘겨 본다.
  notifications: {
    slot: {
      label: '알림',
      // 배지의 숫자는 그림이라 읽히지 않는다. 이름이 그 숫자를 말한다.
      labelWithCount: '알림 (안 읽은 알림 {count}건)',
      title: '알림',
      closeLabel: '닫기',
    },
    title: '알림함',
    description:
      '입점 신청과 신고 처리 결과가 여기로 옵니다. 상단바의 종은 30초마다 새로 확인하고, 탭이 가려져 있는 동안에는 묻지 않습니다.',
    typeLabels: {
      ORDER_STATUS: '주문 상태',
      CLAIM_STATUS: '취소·반품',
      REVIEW_REPLY: '리뷰 답글',
      QUESTION_ANSWER: '문의 답변',
      RESTOCK: '재입고',
      NEW_PRODUCT: '신상품',
      SELLER_SETTLEMENT: '정산',
      SELLER_ORDER: '새 주문',
      SELLER_CLAIM: '클레임 접수',
      ADMIN_SELLER_APPLICATION: '입점 신청',
      REPORT_HANDLED: '신고 처리',
    },
    badgeOverflow: '{max}+',
    loadingLabel: '알림을 불러오는 중',
    errorTitle: '알림을 불러오지 못했어요',
    retryLabel: '다시 시도',
    emptyTitle: '아직 알림이 없어요',
    emptyDescription: '입점 신청이 들어오거나 신고가 처리되면 여기에 쌓입니다.',
    unreadEmptyTitle: '안 읽은 알림이 없어요',
    unreadEmptyDescription: '「안 읽은 것만」을 끄면 지난 알림도 볼 수 있습니다.',
    listLabel: '알림 목록',
    unreadLabel: '안 읽음',
    unreadCount: '안 읽은 알림 {count}건',
    allReadLabel: '모두 읽음',
    allReadDone: '모든 알림을 읽음으로 표시했어요.',
    markReadLabel: '읽음으로 표시',
    viewAll: '알림함 전체 보기',
    unreadOnlyLabel: '안 읽은 것만',
    unreadOnlyDescription: '켜면 아직 읽지 않은 알림만 보여 줍니다.',
    noLink: '이 알림에는 이동할 화면이 없습니다.',
    failedTitle: '알림을 처리하지 못했어요',
    signedOut: '로그인하면 알림을 볼 수 있습니다.',
    pagination: {
      label: '알림 목록 페이지',
      next: '다음',
      previous: '이전',
      pageUnit: ' 페이지',
      countUnit: '건',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 대시보드 (TASK-0092). 문이 셋이라 슬라이스도 셋으로 갈린다 — 한 섹션이
  // 실패해도 나머지는 그려져야 하고, 그러려면 오류 제목과 「다시 시도」가
  // 섹션마다 있어야 한다.
  dashboard: {
    description: '지금 처리해야 할 일과 플랫폼 전체 지표를 한 화면에서 봅니다.',
    forbiddenTitle: '대시보드를 볼 수 없습니다',
    // 처리 대기 — 이 화면의 목적이다. 그래서 맨 위에 있고, 각 줄이 그 일을
    // 처리하는 화면으로 바로 간다.
    pending: {
      title: '처리 대기',
      description: '기간과 무관합니다. 3주 전에 들어온 신청도 아직 안 봤으면 오늘 할 일이에요.',
      loadingLabel: '처리 대기 항목을 불러오는 중입니다',
      errorTitle: '처리 대기 항목을 불러오지 못했어요',
      retryLabel: '다시 시도',
      allClear: '지금 처리를 기다리는 일이 없어요.',
      totalCount: '모두 {count}건',
      labels: {
        sellerApplications: '판매자 승인',
        claims: '클레임 개입',
        reports: '신고 처리',
        settlements: '정산 승인',
      },
      countValue: '{count}건',
      listLabel: '처리 대기 항목',
    },
    metrics: {
      title: '핵심 지표',
      regionLabel: '지표 요약',
      loadingLabel: '지표를 불러오는 중입니다',
      errorTitle: '지표를 불러오지 못했어요',
      retryLabel: '다시 시도',
      salesLabel: '거래액',
      orderCountLabel: '주문 수',
      newUsersLabel: '신규 가입',
      activeSellersLabel: '활성 판매자',
      orderCountValue: '{count}건',
      newUsersValue: '{count}명',
      activeSellersValue: '{count}곳',
      activeSellersNote: '기간 안에 한 건이라도 판 스토어입니다. 등록된 스토어 수가 아니에요.',
      // 직전 같은 길이 기간과 비교한다. 「전월 대비」가 아닌 이유는 기간을 사람이
      // 고르기 때문이다 — 7일을 보고 있는 사람에게 지난달과의 비교는 화면의 어느
      // 것과도 짝이 맞지 않는다.
      comparison: {
        label: '직전 {days}일 대비',
        up: '{percent}% 늘었어요',
        down: '{percent}% 줄었어요',
        flat: '변화 없어요',
        none: '직전 기간에 기록이 없어 비교할 수 없어요',
      },
      filters: {
        legend: '조회 기간',
        fromLabel: '시작일',
        toLabel: '종료일',
        reset: '최근 30일로',
        rangeIncomplete: '시작일과 종료일을 모두 골라 주세요.',
        rangeReversed: '종료일이 시작일보다 앞서 있어요. 두 날짜를 확인해 주세요.',
        rangeTooLong: '한 번에 최대 {max}일까지 볼 수 있어요. 기간을 줄여 주세요.',
      },
      periodValue: '{from} ~ {to}',
    },
    // 그림은 장식이고 표가 내용이다. 표는 접혀도 DOM 에서 사라지지 않는다.
    chart: {
      title: '거래액 추이',
      peak: '가장 많이 판 날 {amount}',
      empty: '이 기간에는 그릴 거래가 없어요.',
      caption: '그래프는 장식입니다. 같은 숫자가 아래 표에 있어요.',
      tableCaption: '날짜별 거래액과 주문 수',
      showTable: '표로 보기',
      hideTable: '표 접기',
      dateHeader: '날짜',
      salesHeader: '거래액',
      orderCountHeader: '주문 수',
    },
    rankings: {
      productsTitle: '인기 상품',
      productsCaption: '거래액 상위 상품',
      productsEmpty: '이 기간에 팔린 상품이 없어요.',
      sellersTitle: '인기 판매자',
      sellersCaption: '거래액 상위 판매자',
      sellersEmpty: '이 기간에 판 스토어가 없어요.',
      nameHeader: '상품',
      brandHeader: '스토어',
      salesHeader: '거래액',
      orderCountHeader: '주문 수',
      note: '거래액 기준 상위 {count}개까지만 보여줍니다.',
    },
    // 시스템 상태. never 와 stale 을 가른다 — 한 번도 안 돈 것은 갓 뜬 프로세스의
    // 정상 상태이고, 돌다가 멈춘 것은 사고다. 둘을 같은 색으로 칠하면 배포
    // 직후마다 빨간 화면을 보게 되고, 몇 번 반복되면 사람은 그 색을 안 믿는다.
    system: {
      title: '시스템 상태',
      description: '배치가 하나 멈추면 조용히 문제가 쌓입니다. 여기서 먼저 보입니다.',
      loadingLabel: '시스템 상태를 불러오는 중입니다',
      errorTitle: '시스템 상태를 불러오지 못했어요',
      retryLabel: '다시 시도',
      summary: {
        stopped: '배치 {count}개가 멈춰 있어요. 지금 확인이 필요합니다.',
        idle: '배치 {count}개가 아직 한 번도 돌지 않았어요. 방금 배포했다면 정상입니다.',
        ok: '모든 배치가 제때 돌고 있어요.',
      },
      statusLabels: {
        ok: '정상',
        stale: '멈춤',
        never: '실행 전',
      },
      // 배치 하나당 한국어 이름. 전수라 서버에 배치가 하나 늘면 여기가
      // typecheck 에서 걸린다.
      names: {
        'reservation.sweep.lastRunAt': '재고 예약 만료 정리',
        'order.confirm.lastRunAt': '구매 확정 처리',
        'shipping.delivery.lastRunAt': '배송 진행 시뮬레이션',
        'payment.reconcile.lastRunAt': '결제 대사',
        'payment.straggler.lastRunAt': '미승인 결제 정리',
        'settlement.batch.lastRunAt': '정산 회차 생성',
        'claims.refund.lastRunAt': '환불 재시도',
        'point.expiry.lastRunAt': '적립금 소멸',
        'coupon.expiry.lastRunAt': '쿠폰 만료 처리',
        'demo.cleanup.lastRunAt': '데모 계정 정리',
      },
      caption: '배치별 마지막 실행 시각',
      nameHeader: '배치',
      statusHeader: '상태',
      lastRunHeader: '마지막 실행',
      neverRun: '아직 없음',
      searchIndex: {
        title: '검색 색인 큐',
        pending: '대기 {count}건',
        oldest: '가장 오래 기다린 줄 {at}',
      },
      unnamedNotice: '이 콘솔이 아직 이름을 모르는 배치예요. 콘솔을 최신으로 올려주세요.',
      demo: {
        title: '데모 계정',
        activeAccounts: '사용 중 {count}개',
        expiringWithinHour: '1시간 안에 만료 {count}개',
        link: '데모 계정 관리로',
      },
    },
    failures: {
      network: '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 회원 관리 (TASK-0093). 목록은 가려진 값만 그리고, 가리지 않은 값은 사유를 적은
  // 뒤에만 열린다 — 막는 것이 아니라 **가르는 것**이 이 화면의 설계다 (4.1).
  users: {
    description:
      '회원을 찾아 상세를 열고, 역할·정지·적립금을 조정합니다. 목록은 개인정보가 가려진 채로 보이고, 가려지지 않은 값을 열 때는 사유가 기록에 남습니다.',
    forbiddenTitle: '회원을 볼 수 없어요',
    roleNames: {
      BUYER: '구매자',
      SELLER_OWNER: '판매자',
      ADMIN_OPERATOR: '운영자',
      ADMIN_SUPER: '최고관리자',
      DEMO_ADMIN: '데모 관리자',
    },
    list: {
      loadingLabel: '회원을 불러오는 중',
      errorTitle: '회원을 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '아직 가입한 회원이 없어요',
      emptyDescription: '가입이 시작되면 여기에 쌓입니다.',
      filteredEmptyTitle: '이 조건에 맞는 회원이 없어요',
      filteredEmptyDescription: '검색어를 줄이거나 역할·상태 조건을 지워 보세요.',
      listLabel: '회원 목록',
      // 이 한 줄이 없으면 별이 박힌 문자열은 고장으로 읽히고, 사람은 그것을
      // 그대로 검색창에 붙여 넣는다 (4.2).
      maskedNotice:
        '목록에는 이메일과 이름이 가려진 채로 보입니다. 검색은 가려지지 않은 원래 값으로 찾으니 아는 이메일을 그대로 입력해 주세요.',
      columns: {
        account: '회원',
        roles: '역할',
        status: '상태',
        createdAt: '가입',
        lastLoginAt: '마지막 로그인',
        open: '상세',
      },
      filters: {
        legend: '회원 검색 조건',
        searchLabel: '이메일 · 이름',
        searchPlaceholder: '예) hong@example.com',
        searchHint: '가려지지 않은 원래 값으로 찾습니다.',
        searchSubmit: '검색',
        roleLabel: '역할',
        roleAll: '전체',
        demoLabel: '계정 종류',
        demoAll: '전체',
        demoOnly: '데모 계정만',
        realOnly: '실계정만',
        suspendedLabel: '상태',
        suspendedAll: '전체',
        suspendedOnly: '정지된 회원만',
        activeOnly: '정상 회원만',
        reset: '조건 지우기',
      },
      demoBadge: '데모',
      suspendedBadge: '정지',
      activeBadge: '정상',
      neverLoggedIn: '기록 없음',
      noRoles: '없음',
      openLabel: '상세 보기',
      pagination: {
        label: '회원 목록 페이지',
        next: '다음',
        previous: '이전',
        pageUnit: ' 페이지',
        countUnit: '명',
      },
    },
    view: {
      title: '가려지지 않은 정보 열기',
      description:
        '이 회원의 이메일과 이름을 가려지지 않은 채로 봅니다. 왜 봐야 하는지 적어 주세요.',
      closeLabel: '창 닫기',
      cancel: '취소',
      submit: '열기',
      submitting: '여는 중',
      targetLabel: '여는 회원',
      reasonLabel: '열람 사유',
      reasonHint: '적은 문장이 누가 언제 열었는지와 함께 그대로 남습니다.',
      reasonPlaceholder: '예) 배송 사고 문의 접수(#12345) 확인을 위해 연락처를 확인합니다.',
      // 미리 채워 두지 않는 이유를 사람에게도 말한다 — 알고 적는 것과 모르고 적는
      // 것은 다른 문장이 된다.
      notice:
        '열람 기록은 지울 수 없고, 같은 회원을 여러 번 열면 그만큼 여러 줄이 남습니다. 나중에 읽는 사람이 이해할 수 있게 적어 주세요.',
      failedTitle: '정보를 열지 못했어요',
      submitError: '정보를 열지 못했어요. 잠시 후 다시 시도해 주세요.',
      errors: {
        reasonRequired: '열람 사유를 적어 주세요. 사유 없이는 열 수 없습니다.',
        reasonTooLong: '사유는 {max}자까지 쓸 수 있어요.',
      },
    },
    detail: {
      title: '회원 상세',
      closeLabel: '상세 닫기',
      loadingLabel: '회원 정보를 여는 중',
      emailLabel: '이메일',
      nameLabel: '이름',
      rolesLabel: '역할',
      createdAtLabel: '가입',
      lastLoginAtLabel: '마지막 로그인',
      statusLabel: '상태',
      neverLoggedIn: '기록 없음',
      statusActive: '정상',
      statusSuspended: '정지',
      suspendedSince: '{datetime}부터',
      suspendedReason: '사유: {reason}',
      demoNotice:
        '체험용으로 발급된 데모 계정입니다. 수명이 지나면 계정과 생성한 데이터가 함께 지워집니다.',
      statsTitle: '이 회원의 활동',
      // 계약이 숫자만 싣는 이유를 화면도 말한다 (`adminUserStatsSchema`).
      statsNote:
        '건수와 금액만 보여줍니다. 주문서나 리뷰 본문이 필요하면 각 화면에서 이 회원을 조건으로 찾아 주세요.',
      stats: {
        orderCount: '주문',
        paidAmount: '결제 합계',
        reviewCount: '리뷰',
        questionCount: '문의',
        pointBalance: '적립금 잔액',
        couponCount: '보유 쿠폰',
        countValue: '{count}건',
      },
    },
    roles: {
      title: '역할',
      description: '역할을 부여하면 그 역할의 앱과 기능이 곧바로 열립니다.',
      grantLabel: '부여할 역할',
      grantSubmit: '부여',
      grantPlaceholder: '역할을 고르세요',
      revokeLabel: '{role} 회수',
      none: '아직 아무 역할도 없습니다.',
      exhausted: '더 부여할 역할이 없습니다.',
      adminNotice:
        '관리자 역할을 부여하면 이 콘솔 전체가 열립니다. 회수할 수는 있지만 그 사이에 한 일은 되돌아오지 않습니다.',
      confirm: {
        title: '관리자 역할을 부여할까요',
        description: '{role} 역할을 부여합니다. 이 콘솔의 화면과 기능이 곧바로 열립니다.',
        confirm: '부여',
        cancel: '취소',
        closeLabel: '창 닫기',
      },
      failedTitle: '역할을 바꾸지 못했어요',
    },
    suspension: {
      title: '계정 정지',
      description: '정지된 회원은 로그인할 수 없습니다.',
      // 되돌릴 수 있다는 것과, 이미 로그인한 세션도 끊긴다는 것 (4.4).
      notice:
        '정지는 탈퇴가 아니라 되돌릴 수 있는 조치입니다. 정지하면 이미 로그인해 있던 세션도 함께 끊깁니다.',
      suspendLabel: '정지하기',
      reinstateLabel: '정지 해제',
      submitting: '처리하는 중',
      reasonLabel: '정지 사유',
      reasonHint: '사유 없이는 정지할 수 없습니다. 나중에 해제를 판단할 근거가 이 문장입니다.',
      reasonPlaceholder: '예) 반복적인 허위 리뷰 작성이 확인되어 정지합니다.',
      activeTitle: '지금 정지된 계정입니다',
      activeSince: '{datetime}부터',
      activeReason: '사유: {reason}',
      failedTitle: '정지 상태를 바꾸지 못했어요',
      submitError: '정지 상태를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.',
      errors: {
        reasonRequired: '정지 사유를 적어 주세요. 사유 없이는 정지할 수 없습니다.',
        reasonTooLong: '사유는 {max}자까지 쓸 수 있어요.',
      },
    },
    points: {
      title: '적립금 조정',
      description: '지급은 양수로, 차감은 음수로 적습니다.',
      notice:
        '지급한 적립금에는 유효기간이 없습니다. 차감은 잔액까지만 가고 잔액이 모자라면 있는 만큼만 빠집니다.',
      balanceLabel: '지금 잔액',
      amountLabel: '조정 금액',
      amountHint: '원 단위 정수로 적어 주세요. 지급은 1000, 차감은 -1000 처럼 씁니다.',
      amountPlaceholder: '예) -1000',
      reasonLabel: '조정 사유',
      // 다른 사유와 무게가 다르다 — 주문도 클레임도 가리키지 않는 원장 줄이다 (4.5).
      reasonHint: '이 줄은 주문도 클레임도 가리키지 않습니다. 적은 사유가 유일한 근거로 남습니다.',
      reasonPlaceholder: '예) 배송 지연 보상으로 1,000원을 지급합니다.',
      submitLabel: '조정하기',
      submitting: '조정하는 중',
      failedTitle: '적립금을 조정하지 못했어요',
      submitError: '적립금을 조정하지 못했어요. 잠시 후 다시 시도해 주세요.',
      errors: {
        amountRequired: '조정 금액을 원 단위 정수로 적어 주세요.',
        amountZero: '0원은 조정이 아닙니다. 지급은 양수로, 차감은 음수로 적어 주세요.',
        reasonRequired: '조정 사유를 적어 주세요. 사유 없이는 조정할 수 없습니다.',
        reasonTooLong: '사유는 {max}자까지 쓸 수 있어요.',
      },
      applied: {
        exact: '{amount} 조정했어요.',
        // 요청한 숫자를 그대로 그리면 거짓말이 된다 (`pointsOutcome`).
        clipped: '{requested} 조정하려 했지만 잔액까지만 갈 수 있어 {applied} 만큼만 빠졌어요.',
        none: '잔액이 없어 {requested} 차감이 반영되지 않았어요. 원장에도 남지 않았습니다.',
      },
    },
    toast: {
      regionLabel: '알림',
      closeLabel: '닫기',
      suspended: '계정을 정지했어요. 목록에서 상태를 확인할 수 있어요.',
      reinstated: '정지를 해제했어요. 목록에서 상태를 확인할 수 있어요.',
      granted: '{role} 역할을 부여했어요.',
      revoked: '{role} 역할을 회수했어요.',
    },
    refusals: {
      // F8. 데모 관리자는 `user.write` 를 아예 갖고 있지 않고, 운영자도 없다 (4.6).
      forbidden:
        '이 계정으로는 회원을 정지하거나 적립금을 바꿀 수 없어요. 최고관리자에게 요청해 주세요.',
      stale: '이미 다른 관리자가 바꿔 놓았어요. 목록을 새로고침한 뒤 다시 확인해 주세요.',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 스토어 지표와 제재 이력 (TASK-0094). `sellers` 와 **다른 슬라이스**다 — 저쪽은
  // 「이 신청을 승인할까」이고 이쪽은 「어느 스토어를 봐야 하나」다 (4.3).
  stores: {
    tabLabel: '스토어 지표',
    description: '매출·클레임률·평점으로 스토어를 줄 세우고, 한 스토어의 제재 이력을 확인합니다.',
    forbiddenTitle: '스토어 지표를 볼 수 없어요',
    list: {
      loadingLabel: '스토어를 불러오는 중',
      errorTitle: '스토어를 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '아직 등록된 스토어가 없어요',
      emptyDescription: '입점 신청이 승인되면 여기에 쌓입니다.',
      filteredEmptyTitle: '이 조건에 맞는 스토어가 없어요',
      filteredEmptyDescription: '상태나 계정 종류 조건을 지워 보세요.',
      listLabel: '스토어 지표',
      // 빈칸이 0이 아니라는 것을 표보다 먼저 말한다 (4.5). 이것을 모르면 클레임률
      // 순으로 세운 목록의 맨 위가 무엇인지도 오해한다.
      metricNotice:
        '아직 한 건도 팔지 않은 스토어는 클레임률이 「판매 없음」으로 보입니다. 0%가 아니라 아직 잴 수 없다는 뜻이고, 클레임률 정렬에서는 줄에 서지 않습니다.',
      demoBadge: '데모',
      noSales: '판매 없음',
      noRatings: '평가 없음',
      ratingValue: '{score}점 · {count}명',
      countValue: '{count}건',
      productCountValue: '{count}개',
      followerValue: '{count}명',
      historyLabel: '이력 보기',
      columns: {
        store: '스토어',
        status: '상태',
        sales: '매출',
        orders: '주문',
        claimRate: '클레임률',
        rating: '평점',
        products: '상품',
        followers: '팔로워',
        createdAt: '개설',
        history: '제재 이력',
      },
      filters: {
        legend: '스토어 조건',
        statusLabel: '상태',
        statusAll: '전체',
        demoLabel: '계정 종류',
        demoAll: '전체',
        demoOnly: '데모 스토어만',
        realOnly: '실계정만',
        sortLabel: '정렬',
        sortNames: {
          recent: '최근 개설 순',
          sales: '매출 높은 순',
          claimRate: '클레임률 높은 순',
        },
        reset: '조건 지우기',
      },
      pagination: {
        label: '스토어 목록 페이지',
        next: '다음',
        previous: '이전',
        pageUnit: ' 페이지',
        countUnit: '곳',
      },
    },
    history: {
      title: '제재 이력',
      closeLabel: '이력 닫기',
      loadingLabel: '이력을 불러오는 중',
      errorTitle: '이력을 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '아직 이력이 없어요',
      emptyDescription: '상태가 바뀌면 그 순간이 여기에 한 줄씩 쌓입니다.',
      listLabel: '스토어 상태 변경 이력',
      kinds: {
        sanction: '정지',
        lift: '정지 해제',
        approval: '승인',
        rejection: '반려',
        filed: '신청 접수',
      },
      columns: {
        movedAt: '시각',
        change: '변경',
        reason: '사유',
        actor: '처리자',
      },
      // 이 표가 생긴 이유를 한 줄로 (4.6).
      summary: '지금까지 {count}번 정지된 적이 있어요.',
      noSanction: '정지된 적이 없는 스토어예요.',
      noReason: '적힌 사유 없음',
      systemActor: '시스템',
      adminActor: '관리자',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 전체 상품과 강제 숨김 (TASK-0095). 상태 이름은 판매자 콘솔과 같은 말을 쓴다 —
  // 같은 상품을 두 콘솔이 다르게 부르면 판매자와 운영자가 다른 것을 이야기하게 된다.
  adminProducts: {
    description:
      '모든 스토어의 상품을 스토어·카테고리·상태로 좁혀 보고, 부적절한 상품을 사유와 함께 내립니다.',
    forbiddenTitle: '전체 상품을 볼 수 없어요',
    statusLabels: {
      DRAFT: '작성 중',
      ACTIVE: '판매 중',
      INACTIVE: '판매 중지',
      SUSPENDED: '노출 정지',
    },
    list: {
      loadingLabel: '상품을 불러오는 중',
      errorTitle: '상품을 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '아직 등록된 상품이 없어요',
      emptyDescription: '판매자가 상품을 올리면 여기에 쌓입니다.',
      filteredEmptyTitle: '이 조건에 맞는 상품이 없어요',
      filteredEmptyDescription: '스토어·카테고리·상태 조건을 지워 보세요.',
      listLabel: '전체 상품 목록',
      hiddenBadge: '강제 숨김',
      noPrice: '가격 없음',
      unknownSeller: '이름을 못 찾은 스토어',
      unknownCategory: '이름을 못 찾은 카테고리',
      stockValue: '{count}개',
      variantValue: '옵션 {count}개',
      // 초안과 판매 중지는 이미 진열되어 있지 않다 (4.2).
      notModeratable: '진열 중이 아니라 내릴 것이 없어요',
      hideLabel: '내리기',
      restoreLabel: '다시 올리기',
      columns: {
        product: '상품',
        seller: '스토어',
        category: '카테고리',
        status: '상태',
        price: '가격',
        stock: '재고',
        action: '조치',
      },
      filters: {
        legend: '상품 조건',
        searchLabel: '상품 이름',
        searchPlaceholder: '이름의 일부',
        searchHint: '판매 중이 아닌 상품도 함께 찾습니다.',
        searchAction: '검색',
        sellerLabel: '스토어',
        sellerAll: '전체',
        sellerLoading: '스토어를 불러오는 중',
        sellerNotice:
          '스토어가 많으면 목록에 다 담기지 않을 수 있습니다. 찾는 스토어가 없으면 스토어 지표에서 확인해 주세요.',
        categoryLabel: '카테고리',
        categoryAll: '전체',
        categoryLoading: '카테고리를 불러오는 중',
        statusLabel: '상태',
        statusAll: '전체',
        reset: '조건 지우기',
      },
      pagination: {
        label: '상품 목록 페이지',
        next: '다음',
        previous: '이전',
        pageUnit: ' 페이지',
        countUnit: '개',
      },
    },
    hide: {
      title: '상품 내리기',
      description: '이 상품의 판매를 멈춥니다. 왜 내리는지 적어 주세요.',
      closeLabel: '창 닫기',
      cancel: '취소',
      submit: '내리기',
      submitting: '내리는 중',
      targetLabel: '내리는 상품',
      reasonLabel: '숨김 사유',
      reasonHint: '적은 문장이 상품에 그대로 남고, 판매자에게 설명할 근거가 됩니다.',
      reasonPlaceholder: '예) 허용되지 않은 상표를 상품명에 사용해 노출을 중지합니다.',
      // 내리면 검색 색인에서도 함께 빠진다 — 목록에 없는데 검색으로 나오면 그것은
      // 안 가려진 것이다 (4.2).
      notice:
        '내려진 상품은 구매자 화면과 검색 결과에서 함께 사라집니다. 판매자가 스스로 다시 올릴 수는 없고, 여기서만 되돌릴 수 있습니다.',
      submitError: '상품을 내리지 못했어요. 잠시 후 다시 시도해 주세요.',
      errors: {
        reasonRequired: '숨김 사유를 적어 주세요. 사유 없이는 내릴 수 없습니다.',
        reasonTooLong: '사유는 {max}자까지 쓸 수 있어요.',
      },
    },
    restore: {
      title: '다시 올릴까요',
      description: '이 상품을 다시 판매 중으로 되돌립니다. 구매자 화면과 검색에 다시 나옵니다.',
      confirm: '다시 올리기',
      cancel: '취소',
      closeLabel: '창 닫기',
      targetLabel: '올리는 상품',
    },
    dismissLabel: '닫기',
    toast: {
      regionLabel: '알림',
      closeLabel: '닫기',
      hidden: '상품을 내렸어요. 구매자 화면과 검색에서 함께 빠집니다.',
      restored: '상품을 다시 올렸어요.',
    },
    refusals: {
      // F8. 데모 관리자는 catalog.write 가 demo 로 좁혀져 있다 (D-058). 어느 상품이
      // 데모 계정의 것인지는 목록의 줄에 없어 버튼을 미리 죽일 수 없다 (4.5).
      forbidden:
        '체험용 관리자 계정으로는 실제 판매자의 상품을 내릴 수 없어요. 체험 계정이 만든 상품만 조치할 수 있습니다.',
      stale: '이미 지워졌거나 없는 상품이에요. 목록을 새로고침한 뒤 다시 확인해 주세요.',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 전체 주문 조회 (TASK-0095). 상태를 바꾸는 문구가 없고, **없다는 사실을 말하는**
  // 문구가 있다 (F7 · 4.4).
  adminOrders: {
    description:
      '주문번호·구매자·스토어·기간으로 모든 주문을 찾고, 판매자별 묶음과 결제·환불 내역을 확인합니다.',
    forbiddenTitle: '전체 주문을 볼 수 없어요',
    statusLabels: {
      PAYMENT_PENDING: '결제 대기',
      PAYMENT_FAILED: '결제 실패',
      PAID: '결제완료',
      PREPARING: '상품준비중',
      SHIPPED: '배송중',
      DELIVERED: '배송완료',
      CONFIRMED: '구매확정',
      CANCELED: '취소',
      RETURNED: '반품',
    },
    list: {
      loadingLabel: '주문을 불러오는 중',
      errorTitle: '주문을 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '아직 주문이 없어요',
      emptyDescription: '주문이 들어오면 여기에 쌓입니다.',
      filteredEmptyTitle: '이 조건에 맞는 주문이 없어요',
      filteredEmptyDescription:
        '주문번호는 정확히 일치해야 찾을 수 있습니다. 기간을 넓히거나 조건을 지워 보세요.',
      listLabel: '전체 주문 목록',
      maskedNotice:
        '산 사람의 이름은 가려진 채로 보입니다. 가려지지 않은 값이 필요하면 회원 관리에서 사유를 적고 열어 주세요.',
      bundleValue: '묶음 {count}개',
      openLabel: '주문 상세',
      columns: {
        orderNumber: '주문번호',
        buyer: '구매자',
        bundles: '판매자 묶음',
        paidAmount: '결제 금액',
        createdAt: '주문',
        open: '상세',
      },
      filters: {
        legend: '주문 검색 조건',
        orderNumberLabel: '주문번호',
        orderNumberPlaceholder: '예) 20260906-000123',
        // 부분 일치로 두면 비슷한 번호가 섞여 나온다 (4.3). 모르면 앞 몇 글자만
        // 치고 「없다」를 받는다.
        orderNumberHint: '앞뒤 공백은 알아서 떼지만, 번호는 전부 정확히 같아야 찾습니다.',
        buyerIdLabel: '구매자 id',
        buyerIdPlaceholder: '예) 019596e0-0041-7000-8000-000000000001',
        buyerIdHint: '회원 관리에서 연 상세의 id 를 그대로 붙여 넣어 주세요.',
        sellerLabel: '스토어',
        sellerAll: '전체',
        sellerLoading: '스토어를 불러오는 중',
        fromLabel: '시작일',
        toLabel: '종료일',
        submit: '검색',
        reset: '조건 지우기',
        issues: {
          buyerId: '구매자 id 를 다시 확인해 주세요. 회원 상세에 있는 값 그대로여야 합니다.',
          range: '시작일이 종료일보다 늦어요. 두 날짜를 바꿔 주세요.',
        },
      },
      pagination: {
        label: '주문 목록 페이지',
        next: '다음',
        previous: '이전',
        pageUnit: ' 페이지',
        countUnit: '건',
      },
    },
    detail: {
      title: '주문 상세',
      closeLabel: '상세 닫기',
      orderNumberLabel: '주문번호',
      buyerLabel: '구매자',
      createdAtLabel: '주문 시각',
      paidAmountLabel: '결제 금액',
      bundlesTitle: '판매자별 묶음',
      bundlesLabel: '이 주문의 판매자 묶음',
      bundleColumns: {
        brand: '스토어',
        status: '상태',
        paidAmount: '결제 금액',
      },
      paymentsTitle: '결제와 환불',
      paymentsLabel: '이 주문의 결제 내역',
      paymentColumns: {
        provider: '결제수단',
        status: '상태',
        amount: '승인 금액',
        canceledAmount: '취소 금액',
        approvedAt: '승인 시각',
      },
      paymentsLoadingLabel: '결제 내역을 불러오는 중',
      paymentsErrorTitle: '결제 내역을 불러오지 못했어요',
      paymentsRetryLabel: '다시 시도',
      paymentsEmptyTitle: '결제 내역이 없어요',
      paymentsEmptyDescription: '아직 결제가 시도되지 않은 주문입니다.',
      refundedLabel: '환불 합계',
      notApproved: '승인 전',
      // 「권한이 없어서」가 아니다. 원인과 증상이 멀어서 아무도 그 둘을 잇지 못한다
      // (F7 · 4.4).
      statusNotice:
        '주문 상태는 이 화면에서 바꿀 수 없습니다. 손으로 옮기면 재고·정산·환불이 따라오지 않고, 그 어긋남은 한참 뒤에 정산 금액이 이상하다는 형태로 나타납니다. 결과를 바꿔야 하면 클레임 처리에서 개입해 주세요.',
      claimsLinkLabel: '클레임 관리로 이동',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  // 데모 계정 관리 (TASK-0096). 정리를 여기서 다시 만들지 않고 청소기의 문을
  // 지난다 — 강제 만료도 재시도도 (4.1 · 4.2).
  demoConsole: {
    description:
      '발급된 데모 계정과 정리 상태를 확인하고, 수명·초기 데이터·가상 카드 한도를 조정합니다.',
    forbiddenTitle: '데모 계정 관리를 볼 수 없어요',
    policy: {
      title: '데모 정책',
      description: '새로 발급되는 데모 계정에 적용할 값입니다.',
      // R1. 말하지 않으면 「안 먹혔다」로 읽힌다 (4.4).
      notice:
        '바꾼 값은 이후 발급분부터 적용됩니다. 이미 발급된 계정의 만료 시각은 그대로 두므로, 쓰고 있던 사람의 데모가 갑자기 사라지지 않습니다.',
      loadingLabel: '데모 정책을 불러오는 중',
      errorTitle: '데모 정책을 불러오지 못했어요',
      retryLabel: '다시 시도',
      fields: {
        ttlHours: {
          label: '계정 수명 (시간)',
          hint: '발급 시각부터 이 시간이 지나면 정리 대상이 됩니다.',
        },
        seedOrders: {
          label: '초기 주문 수',
          hint: '발급할 때 미리 만들어 두는 주문 건수입니다.',
        },
        virtualCardLimit: {
          label: '가상 카드 한도 (원)',
          hint: '체험용 가상 카드에 실어 주는 금액입니다.',
        },
      },
      errors: {
        ttlHours: {
          required: '계정 수명을 시간 단위 정수로 적어 주세요.',
          range: '계정 수명은 {min}시간부터 {max}시간까지 정할 수 있어요.',
        },
        seedOrders: {
          required: '초기 주문 수를 정수로 적어 주세요.',
          range: '초기 주문 수는 {min}건부터 {max}건까지 정할 수 있어요.',
        },
        virtualCardLimit: {
          required: '가상 카드 한도를 원 단위 정수로 적어 주세요.',
          range: '가상 카드 한도는 {min}원부터 {max}원까지 정할 수 있어요.',
        },
      },
      submitLabel: '정책 저장',
      submitting: '저장하는 중',
      failedTitle: '데모 정책을 저장하지 못했어요',
      submitError: '데모 정책을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
      current: {
        title: '지금 적용 중',
        ttlHours: '수명 {hours}시간',
        seedOrders: '초기 주문 {count}건',
        virtualCardLimit: '카드 한도 {amount}',
      },
    },
    accounts: {
      title: '데모 계정',
      description: '지금 남아 있는 데모 계정입니다. 만료가 임박한 계정이 위에 옵니다.',
      loadingLabel: '데모 계정을 불러오는 중',
      errorTitle: '데모 계정을 불러오지 못했어요',
      retryLabel: '다시 시도',
      emptyTitle: '남아 있는 데모 계정이 없어요',
      emptyDescription: '누군가 데모를 발급받으면 여기에 나타납니다.',
      filteredEmptyTitle: '정리에 실패한 계정이 없어요',
      filteredEmptyDescription: '조건을 지우면 남아 있는 데모 계정 전체를 볼 수 있어요.',
      listLabel: '데모 계정 목록',
      columns: {
        account: '계정',
        roles: '역할',
        createdAt: '발급',
        expiresAt: '만료 예정',
        cleanup: '정리',
        actions: '처리',
      },
      failedOnlyLabel: '정리에 실패한 계정만 보기',
      expiryLabels: {
        none: '만료 시각 없음',
        expired: '만료됨',
        endingSoon: '곧 만료',
        live: '사용 중',
      },
      noRoles: '없음',
      cleanupNone: '정상',
      cleanupFailedAt: '{datetime}에 실패',
      // 실패는 표가 아니라 칸이다 (4.3).
      cleanupNotice:
        '정리에 실패한 계정은 만료된 채로 남아 다음 주기가 다시 집어 갑니다. 성공하면 이 칸은 그냥 비워집니다.',
      expireLabel: '강제 만료',
      // 지우지 않는다는 것 (4.1). 말하지 않으면 운영자는 실패로 읽는다.
      expireNotice:
        '강제 만료는 계정을 지우지 않고 만료 시각을 지금으로 당깁니다. 실제 삭제는 다음 정리가 하므로 목록에는 잠시 그대로 남습니다.',
      confirm: {
        title: '이 데모 계정을 만료시킬까요',
        description:
          '만료 시각을 지금으로 당깁니다. 다음 정리가 이 계정과 그 계정이 만든 데이터를 지웁니다.',
        confirm: '강제 만료',
        cancel: '취소',
        closeLabel: '창 닫기',
      },
      sweepLabel: '지금 정리 실행',
      sweeping: '정리하는 중',
      sweepNotice:
        '다음 주기를 기다리지 않고 정리를 한 번 돌립니다. 실패했던 계정도 함께 다시 시도합니다.',
      failedTitle: '정리를 실행하지 못했어요',
      pagination: {
        label: '데모 계정 목록 페이지',
        next: '다음',
        previous: '이전',
        pageUnit: ' 페이지',
        countUnit: '개',
      },
    },
    stats: {
      title: '발급 통계',
      description: '고른 기간에 발급된 데모 계정을 일별과 역할별로 함께 보여줍니다.',
      loadingLabel: '발급 통계를 불러오는 중',
      errorTitle: '발급 통계를 불러오지 못했어요',
      retryLabel: '다시 시도',
      summary: {
        activeLabel: '지금 남아 있는 계정',
        failedLabel: '정리에 실패한 계정',
        countValue: '{count}개',
      },
      filters: {
        legend: '통계 기간',
        fromLabel: '시작일',
        toLabel: '종료일',
        reset: '최근 2주로',
        rangeIncomplete: '시작일과 종료일을 모두 골라 주세요.',
        rangeReversed: '종료일이 시작일보다 앞이에요. 두 날짜를 바꿔 주세요.',
        rangeTooLong: '기간은 최대 {max}일까지 볼 수 있어요.',
      },
      daysCaption: '일별 발급 수',
      dateHeader: '날짜',
      issuedHeader: '발급',
      roleHeader: '역할',
      byRoleCaption: '역할별 발급 수',
      byRoleEmpty: '이 기간에 발급된 계정이 없어요.',
      // 이름을 모르는 역할을 숨기면 합이 조용히 어긋난다.
      unnamedRoleNotice:
        '이 콘솔이 아직 이름을 모르는 역할이 있어 열쇠를 그대로 적었습니다. API 가 먼저 배포되면 생길 수 있습니다.',
      totalIssued: '이 기간에 {count}개',
    },
    toast: {
      regionLabel: '알림',
      closeLabel: '닫기',
      expired: '만료 시각을 지금으로 당겼어요. 다음 정리가 이 계정을 집어 갑니다.',
      policySaved: '데모 정책을 저장했어요. 이후 발급분부터 적용됩니다.',
      swept: '{swept}개를 정리했고 {failed}개가 실패했어요.',
      sweptNothing: '지금 정리할 계정이 없었어요.',
    },
    failures: {
      network: '서버에 연결하지 못했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.',
      timeout: '응답이 너무 늦어 요청을 멈췄어요. 잠시 후 다시 시도해 주세요.',
      aborted: '요청을 취소했어요.',
      malformed_response: '서버가 보낸 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
      configuration: '서버 주소 설정이 없어요. 개발 서버를 다시 실행해 주세요.',
      unknown: '알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    },
  },
  layout: {
    // 콘솔 이름. 사이드바 위와 모바일 시트 제목에 같은 문자열이 쓰인다.
    brand: '관리자 콘솔',
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
    // TASK 의 분류다(TASK-0019 4.9).
    //
    // permission 은 그 화면이 API 에 처음 묻는 조회 퍼미션이고, 셸이 그것으로
    // 메뉴를 거른다(TASK-0023). 오늘의 역할 표에서는 콘솔에 들어올 수 있는
    // 역할이 모든 *.read 를 가지므로 실제로 가려지는 항목이 없다 — 없는 차이를
    // 만들어 내지 않고, 필터 자체는 순수 함수 검사가 증명한다. 대응하는
    // 퍼미션이 아직 없는 화면은 비워 둔다(M12·M13 이 채운다).
    menu: [
      { id: 'overview', items: [{ href: '/', label: '대시보드' }] },
      {
        id: 'operations',
        label: '운영',
        items: [
          { href: '/users', label: '회원 관리', permission: 'user.read' },
          // 이 화면은 심사 큐다. seller.read 는 스토어 조회가 공개라서 모든
          // BUYER 가 가지므로, 메뉴가 요구하는 것과 화면이 부르는
          // 엔드포인트가 요구하는 것을 같은 값으로 맞춘다 (TASK-0110 4장).
          { href: '/sellers', label: '판매자 관리', permission: 'seller.approve' },
          { href: '/products', label: '상품 관리', permission: 'product.read' },
          { href: '/orders', label: '주문 관리', permission: 'order.read' },
          { href: '/claims', label: '클레임 관리', permission: 'claim.read' },
          // 신고를 **하는** 것은 누구나 하고(report.write), 처리는 관리자만 한다.
          // 메뉴가 요구하는 것은 화면이 부르는 목록 엔드포인트가 요구하는 것과 같은
          // 값이어야 한다 (TASK-0091).
          { href: '/reports', label: '신고 처리', permission: 'content.moderate' },
        ],
      },
      {
        id: 'catalog',
        label: '카탈로그',
        items: [
          { href: '/categories', label: '카테고리 관리', permission: 'catalog.read' },
          { href: '/attributes', label: '속성 관리', permission: 'catalog.read' },
        ],
      },
      {
        id: 'settlement',
        label: '정산·프로모션',
        items: [
          { href: '/commissions', label: '수수료 설정', permission: 'commission.read' },
          { href: '/settlements', label: '정산 관리', permission: 'settlement.read' },
          { href: '/coupons', label: '플랫폼 쿠폰', permission: 'coupon.read' },
        ],
      },
      {
        id: 'system',
        label: '시스템',
        items: [{ href: '/demo', label: '데모 계정 관리', permission: 'demo.manage' }],
      },
    ],
  },
  // 로그인과 권한 안내 (TASK-0023). 아래 레코드는 전부 @shopping/shared 가
  // 소유한 유니온으로 키가 잡혀 있어, 값이 하나 늘면 여기가 typecheck 에서
  // 걸린다. TASK-0019 가 자리만 잡아 둔 layout.account 팝오버를 대체한다.
  auth: {
    signIn: {
      title: '로그인',
      description: 'Google 계정으로 로그인하면 관리자 콘솔을 쓸 수 있습니다.',
      googleLabel: 'Google 계정으로 계속하기',
      demoLabel: '관리자 데모 계정 받기',
      demoReason: '가입 없이 24시간 동안 심사·정산 대기 건을 직접 처리해볼 수 있습니다.',
      checkingLabel: '로그인 상태를 확인하는 중입니다',
      signedInTitle: '이미 로그인되어 있습니다',
      signedInBody: '관리자 콘솔로 이동하려면 아래 버튼을 눌러주세요.',
      continueLabel: '관리자 콘솔로 이동',
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
        no_role: '로그인은 됐지만 관리자 권한이 없습니다.',
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
      missing_permission: '이 역할로는 할 수 없는 작업입니다.',
      out_of_scope: '이 항목에는 적용할 수 없는 작업입니다.',
    },
    menu: {
      label: '내 계정',
      title: '내 계정',
      closeLabel: '닫기',
      signedOutBody: '관리자 콘솔를 쓰려면 로그인해주세요.',
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
    guard: {
      checkingLabel: '로그인 상태를 확인하는 중입니다',
      title: '관리자 콘솔을 이용할 수 없습니다',
      body: '이 계정에는 관리자 권한이 없습니다. 권한은 관리자가 직접 부여합니다.',
      signInLabel: '다른 계정으로 로그인',
      signOutLabel: '로그아웃',
      pendingNote: '데모 관리자 계정 발급은 곧 이 자리에 들어옵니다.',
    },
  },
  // 데모 계정 (TASK-0024). 배너는 모든 화면 위에 뜨므로 auth 와 나눠 둔다 —
  // auth 는 "로그인되어 있는가" 이고 이쪽은 "그 계정이 언제까지인가" 다.
  demo: {
    endingSoonLabel: '체험 종료 임박',
    bannerLabel: '관리자 데모',
    remaining: '{hours}시간 {minutes}분 뒤에 이 계정과 처리한 내용이 사라집니다.',
    remainingMinutes: '{minutes}분 뒤에 이 계정과 처리한 내용이 사라집니다.',
    expired: '체험 시간이 끝났습니다. 새 데모 계정을 받아주세요.',
    issuePending: '데모 계정을 만드는 중…',
    issueFailedTitle: '데모 계정을 받지 못했습니다',
    issueFailed: '잠시 후 다시 시도해주세요.',
    rateLimited: '조금 전에 여러 번 발급했습니다. 1분 뒤에 다시 시도해주세요.',
    unreachable: '서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',
  },
  placeholder: {
    comingSoon: '준비 중',
    body: '이 화면은 해당 도메인 마일스톤에서 열립니다. 지금은 콘솔 레이아웃을 확인하는 자리입니다.',
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
  } /**
   * One sentence per error code (TASK-0117 4.2).
   *
   * Four rules, and every line below is checked against them by
   * `test/error-messages.spec.ts`:
   *
   * 1. **말은 사용자가 한 행동의 언어로.** `orderedIds` 가 아니라 "순서",
   *    `slug` 가 아니라 "주소".
   * 2. **다음에 무엇을 할지 말한다.** "…할 수 없습니다" 로 끝내지 않는다.
   * 3. **원인을 짚을 수 있으면 이름으로 짚는다.** `{name}` 은 서버가 실어 보낸
   *    값으로 채워진다.
   * 4. **내부 식별자를 쓰지 않는다.** 그것이 F7 이 정규식으로 재는 것이다.
   */,
  errors: {
    // Transport-derived codes. Reached when an endpoint has no domain code yet.
    BAD_REQUEST: '입력하신 내용을 다시 확인해 주세요.',
    VALIDATION_FAILED: '입력하신 내용을 다시 확인해 주세요.',
    UNAUTHORIZED: '로그인이 필요해요.',
    FORBIDDEN: '이 작업을 할 수 있는 권한이 없어요.',
    NOT_FOUND: '찾으시는 내용이 없어요. 목록을 새로고침해 주세요.',
    METHOD_NOT_ALLOWED: '지금은 처리할 수 없는 요청이에요.',
    CONFLICT: '다른 변경과 겹쳤어요. 최신 내용을 불러온 뒤 다시 시도해 주세요.',
    PAYLOAD_TOO_LARGE: '보내신 내용이 너무 커요. 크기를 줄여 주세요.',
    UNSUPPORTED_MEDIA_TYPE: '지원하지 않는 형식이에요. 다른 파일을 선택해 주세요.',
    TOO_MANY_REQUESTS: '요청이 몰렸어요. 잠시 후 다시 시도해 주세요.',
    INTERNAL_ERROR: '일시적인 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    SERVICE_UNAVAILABLE: '지금은 이용할 수 없어요. 잠시 후 다시 시도해 주세요.',

    // Domain codes.
    AUTH_REQUIRED: '로그인이 필요해요.',
    INVALID: '입력하신 값을 다시 확인해 주세요.',
    CATEGORY_SLUG_TAKEN: '이미 쓰고 있는 주소예요. 다른 주소를 입력해 주세요.',
    CATEGORY_VERSION_CONFLICT: '다른 관리자가 먼저 저장했어요. 최신 내용을 불러올까요?',
    CATEGORY_HAS_CHILDREN: '하위 카테고리를 먼저 옮기거나 삭제해 주세요.',
    CATEGORY_MAX_DEPTH: '카테고리는 {max}단계까지만 만들 수 있어요.',
    CATEGORY_MOVE_INTO_SELF: '카테고리를 자기 자신이나 그 아래로 옮길 수 없어요.',
    CATEGORY_REORDER_MISMATCH: '순서가 화면과 어긋났어요. 새로고침한 뒤 다시 시도해 주세요.',
    CATEGORY_PARENT_MISSING: '선택한 상위 카테고리가 없어졌어요. 목록을 새로고침해 주세요.',
    ATTRIBUTE_KEY_TAKEN: "'{name}' 에 같은 이름의 속성이 이미 있어요.",
    ATTRIBUTE_VERSION_CONFLICT: '다른 관리자가 먼저 저장했어요. 최신 내용을 불러올까요?',
    ATTRIBUTE_IN_USE: '이 속성을 쓰는 상품이 {count}개 있어요. 상품에서 먼저 값을 지워 주세요.',

    // 상품 쓰기 (TASK-0113). 이 콘솔에는 아직 상품 편집기가 없지만, 코드 목록이
    // 늘면 문장도 함께 늘어야 한다는 것을 `Record` 가 강제한다 (4.7 J2).
    PRODUCT_ATTRIBUTES_REQUIRED: '판매를 시작하려면 필수 정보를 모두 채워야 해요.',
    PRODUCT_TOO_MANY_VARIANTS:
      '옵션 조합은 최대 {max}개까지 만들 수 있어요. 옵션 값을 줄여 주세요.',
    PRODUCT_NOT_SELLABLE: '판매하려면 주문할 수 있는 옵션이 하나는 있어야 해요.',
    PRODUCT_SELLER_INACTIVE: '스토어가 승인된 뒤에 상품을 등록하거나 수정할 수 있어요.',
    PRODUCT_SKU_TAKEN: '이미 쓰고 있는 상품 코드예요. 다른 코드를 입력해 주세요.',
    PRODUCT_VERSION_CONFLICT: '다른 곳에서 먼저 저장했어요. 최신 내용을 불러올까요?',
    // 장바구니 (TASK-0045). 콘솔은 장바구니를 쓰지 않지만 카탈로그가
    // `Record<UserFacingErrorCode, string>` 이라 문장이 있어야 한다 — 코드를 더하고
    // 문장을 빠뜨리면 빈 줄을 보여 주는 대신 타입 검사가 막는다.
    CART_STOCK_EXCEEDED: '재고보다 많은 수량은 담을 수 없어요.',
    CART_PURCHASE_LIMIT: '1회 구매 가능 수량을 넘었어요.',
    CART_FULL: '장바구니가 가득 찼어요.',
    CART_ITEM_UNAVAILABLE: '지금은 판매하지 않는 상품이에요.',
    // 재고 예약 (TASK-0048). 예약을 부르는 쪽은 주문 생성이라 콘솔에는
    // 나타나지 않지만, 카탈로그가 전수라 문장이 있어야 한다.
    RESERVATION_SOLD_OUT: '방금 다른 분이 먼저 담아가셨어요. 남은 수량을 확인해 주세요.',
    RESERVATION_RELEASED: '주문서에 머무는 시간이 지나 예약이 풀렸어요. 다시 시도해 주세요.',
    RESERVATION_CONFIRMED: '이미 결제가 끝난 주문이에요.',
    RESERVATION_EXPIRED: '예약 시간이 지났어요. 처음부터 다시 진행해 주세요.',
    // 주문 생성 (TASK-0049). 콘솔은 주문을 만들지 않지만 카탈로그가 전수다.
    ORDER_ITEM_MISSING: '장바구니에서 사라진 상품이 있어요. 장바구니를 다시 확인해 주세요.',
    ORDER_ITEM_UNAVAILABLE: '지금은 주문할 수 없는 상품이 있어요.',
    ORDER_PURCHASE_LIMIT: '1회 구매 가능 수량을 넘었어요.',
    ORDER_ADDRESS_MISSING: '배송지를 찾을 수 없어요. 다시 선택해 주세요.',
    // 주문 상태 전이 (TASK-0059). 셋을 나누는 이유는 운영자가 할 일이 다르기
    // 때문이다 — 다시 읽기 / 포기하기 / **모자란 것 채우기**.
    ORDER_TRANSITION_UNDEFINED: '주문 상태가 이미 바뀌었어요. 새로고침한 뒤 다시 확인해 주세요.',
    ORDER_TRANSITION_FORBIDDEN: '이 주문을 그렇게 바꿀 수 있는 권한이 없어요.',
    ORDER_TRANSITION_REQUIREMENT: '아직 채워지지 않은 것이 있어요. 운송장을 먼저 확인해 주세요.',
    // 결제 (TASK-0052). 콘솔은 결제하지 않지만 카탈로그가 전수다.
    PAYMENT_TRANSITION_REFUSED: '지금은 처리할 수 없는 요청이에요.',
    PAYMENT_REFUND_INVALID: '환불 금액이 올바르지 않아요.',
    PAYMENT_AMOUNT_MISMATCH: '결제 금액이 주문 금액과 달라 승인하지 않았어요.',
    PAYMENT_PROVIDER_MISMATCH: '그 결제수단으로 시작한 결제가 아니에요.',
    PAYMENT_AWAITING_RESULT: '앞선 결제의 결과를 확인하는 중이에요. 잠시 후 다시 시도해 주세요.',
    PAYMENT_REFUND_EXCEEDS: '환불할 수 있는 금액을 넘었어요.',
    // 가상 카드 (TASK-0053). 콘솔은 카드를 쓰지 않지만 카탈로그가 전수다.
    CARD_AMOUNT_INVALID: '금액이 올바르지 않아요.',
    CARD_COUNT_REACHED: '카드를 더 만들 수 없어요.',
    CARD_UNUSABLE: '지금은 사용할 수 없는 카드예요.',
    CARD_LIMIT_EXCEEDED: '카드 한도를 넘었어요.',
    CARD_RELEASE_EXCEEDS: '돌려줄 수 있는 금액을 넘었어요.',
    CARD_EXPIRED: '유효기간이 지난 카드예요.',
    RETURN_PHOTO_REQUIRED: '반품 사유를 확인할 수 있는 사진을 첨부해 주세요.',
    RETURN_PHOTO_NOT_ALLOWED: '단순 변심 반품에는 사진을 첨부하지 않습니다.',
    RETURN_PHOTO_TOO_MANY: '사진은 최대 {max}장까지 첨부할 수 있어요.',
    RETURN_PHOTO_DUPLICATE: '같은 사진이 두 번 들어 있어요.',
    RETURN_PHOTO_FOREIGN: '본인이 올린 사진만 첨부할 수 있어요.',
    // 클레임 (TASK-0065). 관리자는 전부에 닿으므로 여섯을 다 만난다 — 그중 하나는
    // 관리자를 가리킨다(`CLAIM_ORDER_CONFIRMED`)는 점이 콘솔 문장과 다른 자리다.
    CLAIM_IN_TRANSIT: '배송 중에는 취소도 반품도 할 수 없어요. 도착한 뒤에 처리해 주세요.',
    CLAIM_ORDER_CONFIRMED: '구매확정한 주문이에요. 일반 반품 절차로는 처리할 수 없어요.',
    CLAIM_WINDOW_CLOSED: '반품할 수 있는 기간이 지났어요.',
    CLAIM_NOT_CLAIMABLE: '지금 상태에서는 취소도 반품도 신청할 수 없어요.',
    // 남은 수량은 서버가 함께 보낸다. 문장에 숫자를 적어 두면 그 숫자만 옛날 값으로 남는다.
    CLAIM_EXCEEDS_REMAINING: '신청할 수 있는 수량을 넘었어요. {remaining}개까지 가능해요.',
    CLAIM_INVALID_QUANTITY: '수량은 1개 이상이어야 해요.',
    CLAIM_ITEM_MISSING: '이 주문에 없는 항목이 섞여 있어요. 다시 확인해 주세요.',
    // 클레임 상태 전이. 주문 쪽 문장과 따로 있는 이유는 화면이 다르기 때문이다.
    CLAIM_TRANSITION_UNDEFINED: '클레임 상태가 이미 바뀌었어요. 새로고침한 뒤 다시 확인해 주세요.',
    CLAIM_TRANSITION_FORBIDDEN: '이 클레임을 그렇게 바꿀 수 있는 권한이 없어요.',
    // TASK-0070. 화면이 먼저 막지만 그것은 친절이고, 규칙은 서버에 있다 — 화면만
    // 막으면 API 를 직접 부르는 길이 남는다.
    CLAIM_REASON_REQUIRED: '거절 사유를 입력해 주세요. 구매자에게 그대로 전달됩니다.',
    // TASK-0076. {available} 은 서버가 실어 보낸 값이다 — 화면이 마지막으로 읽은
    // 잔액을 적으면 방금 다른 곳에서 쓴 금액을 모른 채 거짓을 말한다.
    POINT_INSUFFICIENT: '적립금 잔액이 모자라요. 지금 쓸 수 있는 금액은 {available}원이에요.',
    POINT_AMOUNT_INVALID: '적립금은 1원 이상 원 단위로 입력해 주세요.',
    POINT_ALREADY_RECORDED: '이미 처리된 적립금 내역이에요.',
    SETTLEMENT_WRONG_STATUS: '정산서의 상태가 바뀌었어요. 목록을 새로고침해 주세요.',
    // 리뷰의 거절들 (TASK-0083). 이 콘솔은 리뷰를 쓰지 않지만, 카탈로그가 전수라야
    // 코드가 늘어난 날 빈 문장이 화면에 나오지 않는다.
    REVIEW_NOT_DELIVERED: '아직 배송이 끝나지 않은 주문이에요.',
    REVIEW_ALREADY_WRITTEN: '이미 리뷰를 쓴 주문이에요.',
    REVIEW_WINDOW_CLOSED: '리뷰를 쓸 수 있는 기간이 지났어요.',
    REVIEW_ORDER_CANCELED: '취소되거나 반품된 주문에는 리뷰를 쓸 수 없어요.',
    REVIEW_EDIT_WINDOW_CLOSED: '리뷰를 고칠 수 있는 기간이 지났어요.',
    REVIEW_IMAGE_TOO_MANY: '사진은 최대 {max}장까지 첨부할 수 있어요.',
    REVIEW_IMAGE_FOREIGN: '첨부할 수 없는 사진이에요. 사진을 다시 첨부해 주세요.',
    // 신고의 거절들 (TASK-0091).
    REPORT_OWN_CONTENT: '자기 글은 신고할 수 없어요.',
    REPORT_ALREADY_FILED: '이미 신고한 대상이에요.',
    REPORT_ALREADY_HANDLED: '이미 처리된 신고예요. 목록을 새로고침해 주세요.',
    REPORT_NOT_REMOVABLE: '상품은 지울 수 없어요. 숨김으로 처리해 주세요.',
    USER_SUSPENSION_UNCHANGED: '이미 처리된 회원이에요. 목록을 다시 읽어 주세요.',
    PRODUCT_NOT_MODERATABLE:
      '지금 상태에서는 이 상품을 내리거나 올릴 수 없어요. 목록을 새로고침해 주세요.',
    // 쿠폰 (TASK-0072). 관리자 콘솔은 플랫폼 쿠폰을 내므로 범위 거절을 만날 일이
    // 없지만, 카탈로그가 전수라 문장이 있어야 한다 — 그리고 관리자가 판매자를
    // 대신해 발행하는 길이 열려 있어 아주 없는 것도 아니다.
    COUPON_SCOPE_FORBIDDEN: '판매자 쿠폰은 그 스토어의 상품에만 적용할 수 있어요.',
    COUPON_ISSUE_EXHAUSTED: '준비된 수량이 모두 나갔어요.',
    COUPON_ALREADY_ISSUED: '이미 이 쿠폰을 가진 회원이에요.',
    COUPON_CODE_UNKNOWN: '쿠폰 코드를 다시 확인해 주세요.',
    COUPON_NOT_STARTED: '아직 발급을 시작하지 않은 쿠폰이에요.',
    COUPON_ENDED: '발급 기간이 끝난 쿠폰이에요.',
    COUPON_NOT_APPLICABLE: '이 주문에는 쓸 수 없는 쿠폰이에요.',
    COUPON_ALREADY_USED: '이미 다른 주문에 사용된 쿠폰이에요.',
    COUPON_DEMO_ONLY: '체험용 쿠폰이라 체험 계정에만 지급할 수 있어요.',
    COUPON_SUSPENDED: '발행이 중단된 쿠폰이에요.',
  },
  errorNotice: {
    title: '일시적인 문제가 생겼어요',
    requestIdHint: '문의하실 때 이 번호를 알려주시면 더 빨리 확인할 수 있어요.',
    requestIdLabel: '문의 번호',
    copyLabel: '번호 복사',
    copiedLabel: '복사했어요',
    dismissLabel: '닫기',
  },
}

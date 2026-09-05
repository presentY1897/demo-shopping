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
          { href: '/reports', label: '신고 처리' },
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
          { href: '/commissions', label: '수수료 설정' },
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
    notifications: {
      label: '알림',
      title: '알림',
      body: '알림함은 M11 에서 이 자리에 들어옵니다.',
      closeLabel: '닫기',
    },
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
    // 결제 (TASK-0052). 콘솔은 결제하지 않지만 카탈로그가 전수다.
    PAYMENT_TRANSITION_REFUSED: '지금은 처리할 수 없는 요청이에요.',
    PAYMENT_REFUND_INVALID: '환불 금액이 올바르지 않아요.',
    PAYMENT_REFUND_EXCEEDS: '환불할 수 있는 금액을 넘었어요.',
    // 가상 카드 (TASK-0053). 콘솔은 카드를 쓰지 않지만 카탈로그가 전수다.
    CARD_AMOUNT_INVALID: '금액이 올바르지 않아요.',
    CARD_COUNT_REACHED: '카드를 더 만들 수 없어요.',
    CARD_UNUSABLE: '지금은 사용할 수 없는 카드예요.',
    CARD_LIMIT_EXCEEDED: '카드 한도를 넘었어요.',
    CARD_RELEASE_EXCEEDS: '돌려줄 수 있는 금액을 넘었어요.',
    CARD_EXPIRED: '유효기간이 지난 카드예요.',
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

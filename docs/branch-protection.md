# main 브랜치 보호 규칙

**아직 켜지 않았다.** 켤지 말지는 저장소 소유자가 정한다 — 켜는 순간 지금의 로컬 머지
흐름이 막히기 때문이다. 이 문서는 **무엇을 어떤 순서로 켜야 하는지**와 **켜면 무엇이
달라지는지**를 적어 둔 것이다.

대상: `presentY1897/demo-shopping` 의 `main`.

## 왜 아직 안 켰나

지금 이 저장소는 **로컬에서 머지**한다.

```bash
# feature-<name> 워크트리
git rebase main
pnpm typecheck && pnpm lint && pnpm build && pnpm test

# main 워크트리
git merge --ff-only feature/<name>
git push origin main
```

`main` 에 보호 규칙을 켜면 마지막 `git push origin main` 이 거부된다.
1인 저장소에서 이 흐름은 빠르고 히스토리도 깨끗하므로, 규칙을 켜는 것은
**"CI 를 신뢰할 수 있게 됐으니 이제 우회로를 막는다"** 는 별도의 결정이다.

## 켜는 순서

순서가 중요하다. 3번은 앞의 두 단계가 끝나야 **선택 자체가 불가능**하다 —
GitHub 은 최근에 실제로 보고된 적이 있는 체크 이름만 목록에 보여 준다.

| # | 단계 | 이유 |
| --- | --- | --- |
| 1 | `.github/workflows/ci.yml` 을 `main` 에 머지 | 워크플로가 기본 브랜치에 있어야 이후 PR 에서 자동 실행된다 |
| 2 | PR 을 하나 올려 `typecheck` · `lint` · `build` · `test` 4개가 green 인 것을 확인 | 체크 이름이 GitHub 에 등록된다 |
| 3 | **Require status checks to pass** → 위 4개 선택 | 이름을 목록에서 고를 수 있게 된 뒤에만 가능 |
| 4 | **Require branches to be up to date before merging** (`strict`) | 머지 직전 `main` 기준으로 다시 검사한다. 규칙 3 없이는 의미가 없다 |
| 5 | **Require linear history** | 이 저장소는 rebase + ff 로 운영한다. 머지 커밋을 애초에 못 만들게 한다 |
| 6 | **Allow force pushes** · **Allow deletions** 를 끈 상태로 유지 | 기본값이 꺼짐이다. 되돌릴 수 없는 사고를 막는다 |
| 7 | (선택) **Require a pull request before merging** | 여기서부터 로컬 머지가 막힌다. 아래 "무엇이 달라지나" 참조 |
| 8 | (선택) **Do not allow bypassing the above settings** (API 의 `enforce_admins`) | 소유자 본인에게도 규칙을 적용한다. 켜기 전까지는 관리자가 그냥 push 할 수 있다 |

3~6 만 켜면 지금 흐름은 **그대로 동작한다**(관리자 우회). 흐름이 실제로 바뀌는 것은
7·8 부터다.

## 무엇이 달라지나

### 7번(PR 필수)까지 켠 경우

`main` 워크트리에서의 `git merge --ff-only` + `git push origin main` 이 거부된다.
머지 주체가 **로컬 git 에서 GitHub 으로 넘어간다.**

| | 지금 | 7번을 켠 뒤 |
| --- | --- | --- |
| 브랜치 push | `main` 직접 push | `feature/<name>` 만 push |
| 머지 실행 주체 | 로컬 `git merge --ff-only` | GitHub (`gh pr merge`) |
| `main` 워크트리 | 머지하고 push 하는 곳 | **`git pull --ff-only` 만 하는 곳** |
| CI | 로컬에서 게이트 확인 후 push | PR 에서 4 job green 이어야 머지 버튼이 열림 |
| 소요 | 즉시 | CI 대기 (현재 실측 약 1분 30초) |

바뀐 흐름:

```bash
# feature-<name> 워크트리
git rebase main
git push -u origin feature/<name>
gh pr create --fill

gh pr checks --watch          # 4 job green 대기
gh pr merge --rebase --delete-branch

# main 워크트리
git pull --ff-only
```

주의할 점 두 가지.

- **커밋 SHA 가 바뀐다.** `gh pr merge --rebase` 는 GitHub 이 커밋을 다시 쓰므로
  로컬의 `feature/<name>` 커밋과 `main` 의 커밋은 SHA 가 달라진다. 머지 뒤에는
  로컬 브랜치를 지우고 `main` 을 pull 받는다. (`--merge` 는 규칙 5 와 충돌하고,
  `--squash` 는 커밋 단위를 뭉개므로 이 저장소에는 맞지 않는다.)
- **워크트리가 여러 개면 순서가 있다.** 다른 워크트리에서 rebase 하기 전에
  `main` 워크트리를 먼저 pull 해야 한다. `main` 이 뒤처져 있으면 규칙 4(up to date)
  때문에 PR 이 계속 재검사를 요구한다.

### 8번(관리자 우회 금지)까지 켠 경우

소유자 본인도 예외가 없다. 잘못 머지된 커밋을 `git push --force` 로 되돌리는 것도
막히므로, revert 커밋을 PR 로 올려야 한다. **혼자 쓰는 저장소에서는 사고 복구가
느려지는 쪽이 더 큰 비용**이라, 8번은 마지막에 따로 판단한다.

## 명령

UI 로 켜도 되고 아래 API 로 켜도 된다. **아래 명령은 실행하지 않았다.**

```bash
# 3~6번만 (지금 흐름 유지, 관리자 우회 허용)
gh api -X PUT repos/presentY1897/demo-shopping/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["typecheck", "lint", "build", "test"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

7번을 추가하려면 `required_pull_request_reviews` 를 객체로 바꾼다. 1인 저장소라
승인자는 둘 수 없으므로 승인 수는 0 이다.

```json
"required_pull_request_reviews": {
  "required_approving_review_count": 0,
  "dismiss_stale_reviews": true
}
```

8번은 `"enforce_admins": true`.

확인과 해제:

```bash
gh api repos/presentY1897/demo-shopping/branches/main/protection
gh api -X DELETE repos/presentY1897/demo-shopping/branches/main/protection
```

## 권장

| 시점 | 상태 |
| --- | --- |
| 지금 (M01) | 규칙 없음. 로컬 ff-only 머지 |
| CI 가 몇 번 돌아 신뢰가 생기면 | **3~6번**. 흐름은 그대로고 실수만 막힌다 |
| 배포가 붙은 뒤 (M02 이후) | **7번**. `main` 이 곧 배포이므로 검사를 안 거친 커밋이 들어가면 안 된다 |
| 채용 담당자에게 공개할 때 | 8번은 선택. 켜면 히스토리가 "규칙을 지킨 저장소"로 보이지만 사고 복구가 느려진다 |

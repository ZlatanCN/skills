#!/usr/bin/env bash
#
# release.sh — Semantic version release for a skills repository (git tag based).
#
#   Explicitly designed for the "no registry, git tag = version" model used by
#   agentskills.io / skills.sh / gh skill: a version IS an annotated git tag.
#
# Usage:
#   scripts/release.sh [major|minor|patch|<X.Y.Z>] [options]
#
# Options:
#   -y, --yes         skip all confirmations (required when stdin is not a tty)
#   -n, --dry-run     print the plan and exit without changing anything
#   --allow-dirty     proceed even with uncommitted changes (unsafe; see below)
#   -h, --help        show this help
#
# Behaviors / graceful degradation:
#   * missing CHANGELOG.md              -> created with the new section as head
#   * SKILL.md without a `version:`    -> left untouched (never invented)
#   * `version:` only inside frontmatter -> bumped; body occurrences untouched
#   * no git remote                     -> tag/commit still done, push skipped
#   * no `gh` CLI / not authenticated   -> release creation skipped, hint shown
#   * push failure                        -> tag and commit stay local, message notes it
#
# Safety invariants:
#   * refuses to run in a dirty worktree (unless --allow-dirty)
#   * refuses to create a tag that already exists
#   * push is best-effort: commit+tag always created locally even when the
#     remote is unreachable; only its existence is pre-checked
set -euo pipefail

# ---------------------------------------------------------------- logging
c() { # color helpers; auto-off when not a tty or NO_COLOR is set
  local bold='' red='' green='' yellow='' cyan='' dim='' reset=''
  if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    bold=$'\033[1m'; red=$'\033[31m'; green=$'\033[32m'; yellow=$'\033[33m'
    cyan=$'\033[36m'; dim=$'\033[2m'; reset=$'\033[0m'
  fi
  case "$1" in
    b) printf '%s' "$bold";; r) printf '%s' "$red";;
    g) printf '%s' "$green";; y) printf '%s' "$yellow";;
    c) printf '%s' "$cyan";; d) printf '%s' "$dim";; 0) printf '%s' "$reset";;
  esac
}

STEPN=0
step() { # numbered stage header: "  ◈ 3  推送"
  STEPN=$((STEPN+1))
  printf '  %s◈%s %s%-2s%s %s%s%s\n' "$(c c)" "$(c 0)" "$(c b)" "$STEPN" "$(c 0)" "$(c b)" "$*" "$(c 0)"
}
ok()    { printf '  %s✓%s %s\n' "$(c g)" "$(c 0)" "$*"; }
warn()  { printf '  %s▲%s %s\n' "$(c y)" "$(c 0)" "$*" >&2; }
fail()  { printf '  %s✗%s %s\n' "$(c r)" "$(c 0)" "$*" >&2; }
die()   { fail "$*"; exit 1; }
skip()  { printf '  %s·%s %s\n' "$(c d)" "$(c d)" "$*"; }
item()  { printf '  %s%s%s %s\n' "$(c d)" '◦' "$(c 0)" "$*"; }
banner() { # top-of-run title block
  printf '\n  %s%s%s %s%s%s\n' "$(c b)" 'release.sh' "$(c 0)" "$(c d)" '· git tag = version' "$(c 0)"
  rule
}
rule()  { printf '  %s%s%s\n' "$(c d)" '──────────────────────────────────────────' "$(c 0)"; }
panel() { # boxed block: panel <title>; feed body lines via stdin
  local title="$1" line
  printf '  %s─── %s%s%s%s\n' "$(c d)" "$(c b)" "$title" "$(c 0)" "$(c d) ───────────"
  while IFS= read -r line; do printf '  %s│%s %s\n' "$(c d)" "$(c 0)" "$line"; done
  printf '  %s└───────────────────────────%s\n' "$(c d)" "$(c 0)"
}

# ---------------------------------------------------------------- options
YES=0; DRY=0; ALLOW_DIRTY=0; BUMP=""; VERB=""
usage() { awk 'NR>=2 && /^#/ { sub(/^# ?/, ""); if ($0 != "") print; next } NR>=2 { exit }' "$0"; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage;;
    -y|--yes) YES=1; shift;;
    -n|--dry-run) DRY=1; shift;;
    --allow-dirty) ALLOW_DIRTY=1; shift;;
    major|minor|patch) BUMP="$1"; shift;;
    *) if [[ "$1" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
         VERB="${1#v}"; shift
       else die "unknown argument: $1 (see --help)"; fi;;
  esac
done

# ------------------------------------------------------------- preflight
banner
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repository (run from the repo root)"
git rev-parse --quiet --verify HEAD >/dev/null || die "no commits yet — nothing to release"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" != "HEAD" ]] || die "detached HEAD — 无法确定发布分支，请先 checkout 一个分支"

if [[ -n "$(git status --porcelain)" ]]; then
  if [[ $ALLOW_DIRTY -eq 1 ]]; then
    warn "--allow-dirty: publishing with uncommitted changes"
  elif [[ $DRY -eq 1 ]]; then
    step "检查工作区"
    warn "工作区有未提交的改动（dry-run 不阻断，实际发布会被拒绝）："
    git status --porcelain | sed 's/^/  │ /'
  else
    step "检查工作区"
    fail "工作区有未提交的改动，拒绝发布："
    git status --porcelain | sed 's/^/  │ /'
    die "先 commit/stash；或显式使用 --allow-dirty"
  fi
fi

# ------------------------------------------------------------ version math
# Latest real release: strictly `X.Y.Z` or `vX.Y.Z`, sorted by version, so
# pre-release tags (v0.2.0-rc.1) and stray tags never count as "latest".
LATEST="$(git tag --sort=-v:refname | { grep -Em1 '^v?[0-9]+\.[0-9]+\.[0-9]+$' || true; })"

parse() { # parse MAJ MIN PAT from a vX.Y.Z string; 0 on success
  local v="$1"
  [[ "$v" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 1
  MAJ="${BASH_REMATCH[1]}"; MIN="${BASH_REMATCH[2]}"; PAT="${BASH_REMATCH[3]}"
}

if [[ -z "$LATEST" ]]; then
  # No real release yet. If pre-release tags exist (v0.3.0-rc.2), seed MAJ.MINOR
  # from the highest one so the first real release is not lower than tags already
  # in the repo.
  PRE=("$(git tag --sort=-v:refname | { grep -Em1 '^v?[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$' || true; })")
  if [[ -n "${PRE[0]}" ]]; then
    PBASE="${PRE[0]%%-*}"                 # strip "-rc.N" suffix before parsing
    parse "$PBASE" || die "latest pre-release tag '${PRE[0]}' is malformed — inspect tags"
    PAT=0
    PREV="${PRE[0]}"
  else
    MAJ=0; MIN=0; PAT=0; PREV="(none)"   # truly first release of this repo
  fi
else
  parse "$LATEST" || die "latest tag '$LATEST' is not semver-shaped — inspect tags"
  PREV="$LATEST"
fi

if [[ -n "$VERB" ]]; then
  # Refuse to publish a version lower than what the repo already has:
  # an explicit regressive version would desync tag order vs changelog order.
  if [[ "$PREV" != "(none)" ]]; then
    VMAJ=0; VMIN=0; VPAT=0
    [[ "$VERB" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] \
      && VMAJ="${BASH_REMATCH[1]}" && VMIN="${BASH_REMATCH[2]}" && VPAT="${BASH_REMATCH[3]}"
    if (( VMAJ < MAJ )) \
      || (( VMAJ == MAJ && VMIN < MIN )) \
      || (( VMAJ == MAJ && VMIN == MIN && VPAT < PAT )); then
      die "拒绝发布 ${VERB}：低于已有版本 ${PREV}（禁止回退；若确有原因先删除 tag）"
    fi
  fi
  NEW="$VERB"
else
  case "${BUMP:-patch}" in            # default: patch, only if bump set
    major) NEW="$((MAJ+1)).0.0";;
    minor) NEW="$MAJ.$((MIN+1)).0";;
    patch) NEW="$MAJ.$MIN.$((PAT+1))";;
  esac
fi
TAG="v$NEW"

git rev-parse --quiet --verify "refs/tags/$TAG" >/dev/null && \
  die "tag $TAG already exists — bump or delete it first"

# -------------------------------------------------------------- changelog
DATE="$(date +%Y-%m-%d)"
# conventional-commit style grouping; anything else falls into 其他
RANGE=(); [[ "$PREV" != "(none)" ]] && RANGE=("$PREV..HEAD")
mapfile_cat() { # read git log subjects into global arrays
  local k s
  FEAT=(); FIX=(); DOCS=(); REF=(); OTHER=()
  while IFS= read -r s; do
    [[ -z "$s" ]] && continue
    k="${s%%:*}"                                  # text before first ':'
    k="${k%%(*}"                                  # drop '(<scope>'
    case "$(printf '%s' "$k" | tr '[:upper:]' '[:lower:]')" in
      feat|feature)      FEAT+=("$s");;
      fix|bug)           FIX+=("$s");;
      docs|doc)          DOCS+=("$s");;
      refactor)          REF+=("$s");;
      *)                 OTHER+=("$s");;
    esac
  done < <(git --no-pager log --pretty=tformat:'%s' ${RANGE[@]+"${RANGE[@]}"})
}
mapfile_cat

section() { # builds "### Label" list into $SEC; empty group stays empty
  local label="$1"; shift
  SEC=""
  [[ $# -eq 0 ]] && return
  SEC="### $label"$'\n'
  for s in "$@"; do SEC+="- $s"$'\n'; done
  SEC+=$'\n'   # blank line after each group
}

NOTES=""
{ section "新增" "${FEAT[@]+"${FEAT[@]}"}"; NOTES+="$SEC"; } || true
{ section "修复" "${FIX[@]+"${FIX[@]}"}";  NOTES+="$SEC"; } || true
{ section "文档" "${DOCS[@]+"${DOCS[@]}"}"; NOTES+="$SEC"; } || true
{ section "重构" "${REF[@]+"${REF[@]}"}";  NOTES+="$SEC"; } || true
{ section "其他" "${OTHER[@]+"${OTHER[@]}"}"; NOTES+="$SEC"; } || true
[[ -z "$NOTES" ]] && NOTES="- no notable changes"$'\n'

CHANGELOG=CHANGELOG.md
NEWSECTION="## [$NEW] - $DATE"$'\n\n'"$NOTES"
NEXIST=0; [ -f "$CHANGELOG" ] && NEXIST=1

prepend_changelog() { # insert NEWSECTION right after the leading "# Title" line
  if [[ $NEXIST -eq 0 ]]; then
    printf '# Changelog\n\n%s' "$NEWSECTION" > "$CHANGELOG"
    return
  fi
  {
    head -1 "$CHANGELOG"
    printf '\n%s\n' "$NEWSECTION"
    tail -n +3 "$CHANGELOG"
  } > "$CHANGELOG.tmp" && mv "$CHANGELOG.tmp" "$CHANGELOG" || { rm -f "$CHANGELOG.tmp"; return 1; }
}

# --------------------------------------------------- SKILL.md version bump
# Only touch a `version:` key that already exists inside the first frontmatter
# block. Never invent one; never touch body `version:` lines.
SKILL_FILES=()
_skill_has_version() { # 1 if frontmatter <fm==1> contains a version: key (read-only)
  awk '
    /^---$/ { fm++; next }
    fm == 1 && /^[[:space:]]*version:/ { found=1; exit }
    END { exit found ? 0 : 1 }
  ' "$1"
}
scan_skills() { # fill SKILL_FILES without writing (used by dry-run and real run)
  local f
  SKILL_FILES=()
  for f in */SKILL.md; do
    [[ -f "$f" ]] || continue
    if _skill_has_version "$f"; then
      SKILL_FILES+=("$f")
    else
      skip "$f: frontmatter 没有 version 字段 — 跳过（不新增）"
    fi
  done
}
bump_skill_versions() { # write new version into scanned files only
  local f n=0
  for f in "${SKILL_FILES[@]:-}"; do
    [[ -f "$f" ]] || continue
    if awk -v nv='"'$NEW'"' '
        /^---$/ { fm++; print; next }
        fm == 1 && /^[[:space:]]*version:/ {
          i = index($0, "version:")
          $0 = substr($0, 1, i - 1) "version: " nv
          print; changed=1; next
        }
        { print }
        END { exit changed ? 0 : 1 }
      ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"; then
      n=$((n+1))
    else
      rm -f "$f.tmp"
      warn "$f: version 行更新失败（扫描时已确认存在，异常）"
    fi
  done
  [[ $n -gt 0 ]] && ok "已同步 $n 个 SKILL.md 的 version" || skip "无 version 字段可更新"
}

# ---------------------------------------------------------------- changes
# (computed in dry-run and in real run identically; writes deferred until confirm)
dry_print() { # render the release plan as a boxed panel (dry-run + real run)
  local sk="$( [ ${#SKILL_FILES[@]} -gt 0 ] && echo "${SKILL_FILES[*]}" || echo '(无版本字段，跳过)' )"
  local cl="$([ -f "$CHANGELOG" ] && echo "更新 $CHANGELOG" || echo "新建 $CHANGELOG")"
  local ncm="$([[ "$PREV" != "(none)" ]] && git rev-list --count "$PREV..HEAD" 2>/dev/null || echo 0)"
  panel "发布计划" <<EOF
分支:      $BRANCH
版本:      $PREV → $TAG
SKILL.md:  $sk
CHANGELOG: $cl
变更:      $ncm 个提交
EOF
  printf '\n%s\n' "$NEWSECTION" | sed 's/^/  │ /'
}

# ------------------------------------------------------------ confirmation
confirm() {
  if [[ $YES -eq 1 ]] || [[ $DRY -eq 1 ]]; then return; fi
  if [[ ! -t 0 ]]; then
    die "stdin 不是终端 — 无法交互确认；请加 -y 或 --dry-run"
  fi
  printf '%s发布以上内容吗？%s [y/N] ' "$(c y)" "$(c 0)"
  read -r ans
  case "${ans:-n}" in
    y|Y|yes|YES) return;;
    *) die "已取消";;
  esac
}

# ================================================================ main flow
step "扫描 SKILL.md"
scan_skills
step "识别版本"
item "$PREV → $TAG"
dry_print

[[ $DRY -eq 1 ]] && { ok "dry run 结束 — 未做任何改动"; exit 0; }
confirm

step "写入 CHANGELOG"
if [[ $NEXIST -eq 1 ]] && grep -Fq "## [$NEW] - " "$CHANGELOG" 2>/dev/null; then
  skip "$CHANGELOG 已包含 $NEW 的记录 — 跳过"
else
  prepend_changelog && ok "$CHANGELOG 已更新" || { fail "写入 $CHANGELOG 失败"; exit 1; }
fi

step "同步 SKILL.md 版本号"
bump_skill_versions

# ---------------------------------------------------------------- commit
step "提交并打 tag"
CHANGED=("$CHANGELOG" "${SKILL_FILES[@]}")
git add "${CHANGED[@]}"
if git diff --cached --quiet -- "${CHANGED[@]}" 2>/dev/null; then
  warn "没有实际内容变化 — 跳过 commit，仅打 tag"
else
  git commit -q -m "release: $TAG" -- "${CHANGED[@]}" || { fail "commit 失败"; exit 1; }
  ok "已提交 $(git rev-parse --short HEAD)"
fi
git tag -a "$TAG" -m "Release $TAG" 2>/dev/null || { fail "打 tag $TAG 失败（commit 已生成本地）"; exit 1; }
ok "已打 tag $TAG"

# ------------------------------------------------------------------- push
PUSHED=0; RELEASED=0
step "推送"
if git remote get-url origin >/dev/null 2>&1; then
  if git push origin HEAD "$TAG" 2>/dev/null; then
    ok "已推送 $BRANCH 与 $TAG"
    PUSHED=1
  else
    warn "push 失败 — tag 与 commit 已在本地产"
    warn "稍后手动推送: git push origin HEAD && git push origin $TAG"
  fi
else
  skip "未配置远程 origin — commit/tag 保留在本地"
fi

# ------------------------------------------------------------ gh release
step "GitHub Release"
ORIGIN="$(git remote get-url origin 2>/dev/null || true)"
if [[ $PUSHED -ne 1 ]]; then
  skip "本次未推送成功 — 跳过 Release（tag 仅本地）"
elif [[ "$ORIGIN" != *github.com* ]]; then
  skip "origin 不是 GitHub（${ORIGIN}）— 跳过 Release"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if gh release create "$TAG" --title "Release $NEW" --notes "$NOTES" 2>/dev/null; then
    ok "已创建 GitHub Release $TAG"
    RELEASED=1
  else
    warn "gh release 创建失败（tag 已推送，可在 GitHub 页面手建）"
    warn "手动创建: gh release create $TAG --title \"Release $NEW\" --notes \"$NOTES\""
  fi
else
  skip "未安装/未登录 gh CLI — 跳过 Release（可在 GitHub 页面手建）"
fi

# ---------------------------------------------------------------- summary
step "完成"
panel "发布摘要" <<EOF
版本:     $PREV → $TAG
$( [ $PUSHED -eq 1 ] && echo "推送:     已推送 $BRANCH 与 $TAG" || echo "推送:     未推送（commit/tag 在本地）" )
$( [ $RELEASED -eq 1 ] && echo "Release: GitHub 已创建" || echo "Release: 未创建（见上方提示）" )
EOF
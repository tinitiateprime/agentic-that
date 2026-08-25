#!/usr/bin/env bash
set -euo pipefail

task_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
task_repo_root="$(cd "${task_script_dir}/.." && pwd)"
task_env_example="${task_repo_root}/services/automation-server/.env.example"
task_env_file="${task_repo_root}/services/automation-server/.env.local"

cd "${task_repo_root}"

if [[ ! -f "${task_env_file}" ]]; then
  cp "${task_env_example}" "${task_env_file}"
fi

task_browser_path=""
for task_browser_candidate in google-chrome-stable google-chrome chromium chromium-browser; do
  if command -v "${task_browser_candidate}" >/dev/null 2>&1; then
    task_browser_path="$(command -v "${task_browser_candidate}")"
    break
  fi
done

if [[ -z "${task_browser_path}" ]]; then
  echo "Google Chrome or Chromium was not found. Install it, then run this setup again." >&2
  exit 1
fi

task_set_env() {
  local task_key="$1"
  local task_value="$2"
  if grep -q "^${task_key}=" "${task_env_file}"; then
    sed -i "s|^${task_key}=.*$|${task_key}=${task_value}|" "${task_env_file}"
  else
    printf '%s=%s\n' "${task_key}" "${task_value}" >> "${task_env_file}"
  fi
}

task_current_token="$(sed -n 's/^SERVER_ARCHITECTURE_INTERNAL_TOKEN=//p' "${task_env_file}" | head -n 1)"
if [[ ${#task_current_token} -lt 32 || "${task_current_token}" == replace-with-* ]]; then
  task_current_token="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
fi

task_set_env SERVER_ARCHITECTURE_DEPLOYMENT development
task_set_env SERVER_ARCHITECTURE_INTERNAL_TOKEN "${task_current_token}"
task_set_env SERVER_BROWSER_EXECUTABLE_PATH "${task_browser_path}"
task_set_env SERVER_EXECUTION_ENABLED true
task_set_env SERVER_INSTAGRAM_PUBLISHING_ENABLED true
task_set_env SERVER_PUBLISHING_DRY_RUN_ENABLED true
task_set_env SERVER_PUBLISHING_PREVIEW_ENABLED true
task_set_env SERVER_LOGIN_ENABLED true
task_set_env SERVER_ARCHITECTURE_AUTO_MIGRATE true
task_set_env SERVER_ARCHITECTURE_ALLOW_PUBLIC_BIND false
task_set_env SERVER_LIVE_WORKER_COUNT 2

chmod 600 "${task_env_file}"

npm run server-architecture:preflight

echo
echo "Ubuntu worker configuration is ready."
echo "Start it with: npm run server-architecture:dev"

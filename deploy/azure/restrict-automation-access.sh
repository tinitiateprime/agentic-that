#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <resource-group> <website-app-name> <automation-app-name>" >&2
  exit 2
fi

resource_group=$1
website_app=$2
automation_app=$3

possible_ips=$(az webapp show \
  --resource-group "$resource_group" \
  --name "$website_app" \
  --query possibleOutboundIpAddresses \
  --output tsv)

if [[ -z "$possible_ips" ]]; then
  echo "Azure returned no possible outbound IP addresses for $website_app; access rules were not changed." >&2
  exit 1
fi

priority=100
declare -A desired_rules=()
declare -A configured_rules=()
while IFS=$'\t' read -r configured_name configured_ip; do
  if [[ -n "$configured_name" ]]; then
    configured_rules[$configured_name]=$configured_ip
  fi
done < <(az webapp config access-restriction show \
  --resource-group "$resource_group" \
  --name "$automation_app" \
  --query "ipSecurityRestrictions[?starts_with(name, 'website-egress-')].[name,ipAddress]" \
  --output tsv)

IFS=',' read -r -a addresses <<< "$possible_ips"
for address in "${addresses[@]}"; do
  address=${address//[[:space:]]/}
  [[ -n "$address" ]] || continue
  if [[ ! "$address" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "Azure returned an unexpected outbound IP value: $address" >&2
    exit 1
  fi
  rule_name="website-egress-${address//./-}"
  if [[ -n "${desired_rules[$rule_name]+configured}" ]]; then
    continue
  fi
  desired_rules[$rule_name]=1
  if [[ "${configured_rules[$rule_name]-}" == "$address/32" ]]; then
    priority=$((priority + 1))
    continue
  fi
  az webapp config access-restriction add \
    --resource-group "$resource_group" \
    --name "$automation_app" \
    --rule-name "$rule_name" \
    --action Allow \
    --ip-address "$address/32" \
    --priority "$priority" >/dev/null
  priority=$((priority + 1))
done

for rule_name in "${!configured_rules[@]}"; do
  if [[ -n "$rule_name" && -z "${desired_rules[$rule_name]+configured}" ]]; then
    az webapp config access-restriction remove \
      --resource-group "$resource_group" \
      --name "$automation_app" \
      --rule-name "$rule_name" >/dev/null
  fi
done

az webapp config access-restriction set \
  --resource-group "$resource_group" \
  --name "$automation_app" \
  --default-action Deny \
  --scm-default-action Deny >/dev/null

echo "Automation access now allows the website's possible outbound IPs and denies other traffic."

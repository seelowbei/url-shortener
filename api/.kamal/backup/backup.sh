#!/bin/sh
# Dump each app database with `pg_dump -Fc` and upload it to the S3 backup bucket as
# s3://$BACKUP_BUCKET/<database>/<UTC timestamp>.dump. The bucket's lifecycle rule deletes dumps
# after 14 days.
#
# Runs inside the `backup` accessory (config/deploy.production.yml): nightly from crond, or by hand:
#   bin/kamal accessory exec backup -d production --reuse /usr/local/bin/backup
# The AWS CLI signs requests with the instance role through IMDSv2, so there are no access keys.
# Spec: docs/spec/infrastructure.md#backups
set -eu

: "${BACKUP_BUCKET:?}" "${BACKUP_DATABASES:?}" "${POSTGRES_PASSWORD:?}"
export PGPASSWORD="$POSTGRES_PASSWORD"

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for db in $BACKUP_DATABASES; do
  file="$tmp/$db.dump"
  key="$db/$stamp.dump"
  pg_dump --format=custom --dbname="$db" --file="$file"
  aws s3 cp "$file" "s3://$BACKUP_BUCKET/$key" --only-show-errors
  echo "$(date -u +%FT%TZ) backup: $db -> s3://$BACKUP_BUCKET/$key ($(wc -c <"$file") bytes)"
done

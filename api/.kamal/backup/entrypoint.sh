#!/bin/sh
# Command of the `backup` accessory (config/deploy.production.yml). The image is the official
# postgres:17 Alpine image, so pg_dump matches the server; the AWS CLI comes from the Alpine
# release's own package repository (pinned by the image's Alpine version).
# Spec: docs/spec/infrastructure.md#backups
set -eu

apk add --no-cache aws-cli
aws --version

# 19:00 UTC = 03:00 Asia/Singapore, a quiet hour. Job output goes to the container log
# (`bin/kamal accessory logs backup -d production`).
echo '0 19 * * * /usr/local/bin/backup >/proc/1/fd/1 2>&1' | crontab -
exec crond -f -d 6

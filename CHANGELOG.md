# Changelog

## [0.2.0](https://github.com/seelowbei/url-shortener/compare/v0.1.0...v0.2.0) (2026-11-27)


### Features

* add Sentry and uptime monitoring (build step 2.9) ([#31](https://github.com/seelowbei/url-shortener/issues/31)) ([9f18d53](https://github.com/seelowbei/url-shortener/commit/9f18d53318f179619fe3bd62f5c6c986afeeaf4f))
* **web:** show the app version in the footer ([#28](https://github.com/seelowbei/url-shortener/issues/28)) ([29850f8](https://github.com/seelowbei/url-shortener/commit/29850f876e8a181abf58ec8071a44a36b825da85))

## 0.1.0 (2026-11-27)


### Features

* **api:** add nightly Postgres backups to S3 (build step 2.4) ([#20](https://github.com/seelowbei/url-shortener/issues/20)) ([6aa08de](https://github.com/seelowbei/url-shortener/commit/6aa08dee0a1b8314701bfa88fa2df5f458ff5a79))
* **api:** add Rails 8.1 API skeleton with health endpoints ([#1](https://github.com/seelowbei/url-shortener/issues/1)) ([f7b29e1](https://github.com/seelowbei/url-shortener/commit/f7b29e1ac2d19acafca5b370608c317202b95196))
* **api:** add the Kamal production destination (build step 2.3) ([#19](https://github.com/seelowbei/url-shortener/issues/19)) ([98491b9](https://github.com/seelowbei/url-shortener/commit/98491b9146769dd73b04cee25566a932fec2cba4))
* **api:** first Kamal deploy to staging (build step 1.7) ([#8](https://github.com/seelowbei/url-shortener/issues/8)) ([cf20624](https://github.com/seelowbei/url-shortener/commit/cf20624e01712f3e1e72450dfcbd631d3a054d2d))
* **infra:** add Pulumi staging stack on AWS EC2 (build step 1.6) ([#7](https://github.com/seelowbei/url-shortener/issues/7)) ([f08afda](https://github.com/seelowbei/url-shortener/commit/f08afda6e8805d64f03e765cb56f11332f7e629e))
* **infra:** add the Pulumi prod stack (build step 2.1) ([#17](https://github.com/seelowbei/url-shortener/issues/17)) ([427fd63](https://github.com/seelowbei/url-shortener/commit/427fd630bdfab2a6293795f20f8b4c6bd370ed59))
* **infra:** start and stop staging with pnpm scripts ([#15](https://github.com/seelowbei/url-shortener/issues/15)) ([08c0958](https://github.com/seelowbei/url-shortener/commit/08c095875e49434c3a1a5d5c08bb3df5d512c378))
* **web:** add Next.js skeleton (build step 1.3) ([#3](https://github.com/seelowbei/url-shortener/issues/3)) ([d15ed8e](https://github.com/seelowbei/url-shortener/commit/d15ed8ee7186828b05761a2fd6b0c921694516e4))
* **web:** add vercel.json for Vercel staging (build step 1.8) ([#10](https://github.com/seelowbei/url-shortener/issues/10)) ([d9cdb53](https://github.com/seelowbei/url-shortener/commit/d9cdb537d37c51967ca43ef0da1e8d63dc9766ea))


### Bug Fixes

* **api:** harden the Kamal deploy (SHORT_HOST, secrets check, Postgres connections) ([#9](https://github.com/seelowbei/url-shortener/issues/9)) ([cf55f85](https://github.com/seelowbei/url-shortener/commit/cf55f85c1aa843781a1c719c5c12af19ac88d46a))
* **ci:** pass the Vercel team scope to vercel alias ([#12](https://github.com/seelowbei/url-shortener/issues/12)) ([c67780e](https://github.com/seelowbei/url-shortener/commit/c67780e572f1b1789f476d33e53840271c465035))
* **ci:** set the staging alias through the Vercel REST API ([#13](https://github.com/seelowbei/url-shortener/issues/13)) ([5d7c2c9](https://github.com/seelowbei/url-shortener/commit/5d7c2c9790c9903bbb6ac00052f8651c5bbe74bb))

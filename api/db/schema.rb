# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_11_27_094157) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "citext"
  enable_extension "pg_catalog.plpgsql"

  # Custom types defined in this database.
  # Note that some types may not work with other database engines. Be careful if changing database.
  create_enum "link_scan_status", ["pending", "clean", "flagged"]

  create_table "links", force: :cascade do |t|
    t.bigint "user_id"
    t.citext "code", null: false
    t.text "destination_url", null: false
    t.boolean "custom_alias", default: false, null: false
    t.integer "clicks_count", default: 0, null: false
    t.boolean "stats_public", default: true, null: false
    t.datetime "disabled_at"
    t.datetime "deleted_at"
    t.enum "scan_status", default: "pending", null: false, enum_type: "link_scan_status"
    t.datetime "flagged_at"
    t.string "flag_reason"
    t.datetime "last_scanned_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["code"], name: "index_links_on_code", unique: true
    t.index ["user_id", "created_at"], name: "index_links_on_user_id_and_created_at", order: { created_at: :desc }
  end
end

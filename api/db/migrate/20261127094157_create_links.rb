class CreateLinks < ActiveRecord::Migration[8.1]
  def change
    enable_extension "citext"
    create_enum :link_scan_status, %w[pending clean flagged]

    create_table :links do |t|
      # Null = anonymous. There is no users table yet: the foreign key to users comes with auth (build step 4).
      t.bigint :user_id
      t.citext :code, null: false
      t.text :destination_url, null: false
      t.boolean :custom_alias, null: false, default: false
      t.integer :clicks_count, null: false, default: 0
      t.boolean :stats_public, null: false, default: true
      t.datetime :disabled_at
      t.datetime :deleted_at # soft delete; the code stays reserved
      t.enum :scan_status, enum_type: :link_scan_status, null: false, default: "pending"
      t.datetime :flagged_at
      t.string :flag_reason
      t.datetime :last_scanned_at
      t.timestamps
    end

    add_index :links, :code, unique: true
    add_index :links, [ :user_id, :created_at ], order: { created_at: :desc }
  end
end

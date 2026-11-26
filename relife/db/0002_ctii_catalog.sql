-- Migrates legacy categories and catalog items to the 9 IT CTII Internal Service Request Form options.
-- Guarded with EXISTS (SELECT 1 FROM users) so fresh empty databases still run full demo seeding first.

UPDATE categories
SET is_active = 0
WHERE EXISTS (SELECT 1 FROM users)
  AND id NOT IN (
    'cat-pc-server',
    'cat-share-folder',
    'cat-software',
    'cat-email',
    'cat-printing',
    'cat-network',
    'cat-core-system',
    'cat-report-system',
    'cat-others'
  );

INSERT INTO categories (id, ord, name, parent_id, default_team_id, is_active)
-- Legacy team ids only if they still exist (0003 folds them into team-it), so a re-run never breaks FKs.
SELECT v.id, v.ord, v.name, v.parent_id,
  COALESCE((SELECT id FROM teams WHERE id = v.default_team_id), (SELECT id FROM teams WHERE id = 'team-it')), 1
FROM (
  SELECT 'cat-pc-server' AS id, 0 AS ord, 'PC / Server' AS name, NULL AS parent_id, 'team-l1' AS default_team_id
  UNION ALL SELECT 'cat-share-folder', 1, 'Share Folder', NULL, 'team-infra'
  UNION ALL SELECT 'cat-software', 2, 'Software', NULL, 'team-l1'
  UNION ALL SELECT 'cat-email', 3, 'Email', NULL, 'team-infra'
  UNION ALL SELECT 'cat-printing', 4, 'Printing Service', NULL, 'team-l1'
  UNION ALL SELECT 'cat-network', 5, 'Network', NULL, 'team-infra'
  UNION ALL SELECT 'cat-core-system', 6, 'Core System', NULL, 'team-apps'
  UNION ALL SELECT 'cat-report-system', 7, 'Report System', NULL, 'team-apps'
  UNION ALL SELECT 'cat-others', 8, 'Others', NULL, 'team-l1'
) AS v
WHERE EXISTS (SELECT 1 FROM users)
ON CONFLICT (id) DO UPDATE SET
  ord = excluded.ord,
  name = excluded.name,
  parent_id = excluded.parent_id,
  default_team_id = excluded.default_team_id,
  is_active = 1;

UPDATE catalog_items
SET is_active = 0
WHERE EXISTS (SELECT 1 FROM users)
  AND id NOT IN (
    'cat-item-pc-server',
    'cat-item-share-folder',
    'cat-item-software',
    'cat-item-email',
    'cat-item-printing',
    'cat-item-network',
    'cat-item-core-system',
    'cat-item-report-system',
    'cat-item-others'
  );

INSERT INTO catalog_items (
  id, ord, name, description, icon, ticket_type, category_id,
  default_impact, form_schema, sla_policy_id, is_active, keywords
)
SELECT
  v.id, v.ord, v.name, v.description, v.icon, v.ticket_type, v.category_id,
  v.default_impact, v.form_schema, NULL, 1, v.keywords
FROM (
  SELECT
    'cat-item-pc-server' AS id,
    0 AS ord,
    'PC / Server' AS name,
    'Perangkat PC, laptop, monitor, periferal, atau server.' AS description,
    'laptop' AS icon,
    'incident' AS ticket_type,
    'cat-pc-server' AS category_id,
    'medium' AS default_impact,
    '[{"key":"service_request_type","label":"Service Request Type","type":"select","required":true,"options":["New Request","Enhancement","Problem","Access Rights","Data Extraction","Others"]},{"key":"asset_tag","label":"Nomor Aset / Hostname","type":"text","required":false,"placeholder":"AST-12345 / PC-FIN-01"},{"key":"location","label":"Lokasi Anda","type":"select","required":false,"options":["Kantor Pusat — Lt. 1","Kantor Pusat — Lt. 2","Kantor Pusat — Lt. 3","Cabang Surabaya","Cabang Bandung","Remote / WFH"]}]' AS form_schema,
    '["pc","server","laptop","desktop","monitor","komputer","hardware","hang","mati"]' AS keywords
  UNION ALL
  SELECT
    'cat-item-share-folder',
    1,
    'Share Folder',
    'Akses, pembuatan, izin baca/tulis, atau kendala folder bersama.',
    'folder',
    'service_request',
    'cat-share-folder',
    'low',
    '[{"key":"service_request_type","label":"Service Request Type","type":"select","required":true,"options":["New Request","Enhancement","Problem","Access Rights","Data Extraction","Others"]},{"key":"folder_path","label":"Path / Nama Share Folder","type":"text","required":false,"placeholder":"\\\\fileserver\\Finance\\2026"},{"key":"access_level","label":"Tingkat Akses","type":"select","required":false,"options":["Read Only","Read & Write","Full Control"]}]',
    '["share","folder","shared","drive","permission","akses","nas","file"]'
  UNION ALL
  SELECT
    'cat-item-software',
    2,
    'Software',
    'Instalasi, pembaruan, lisensi, atau kendala aplikasi kerja.',
    'wrench',
    'service_request',
    'cat-software',
    'low',
    '[{"key":"service_request_type","label":"Service Request Type","type":"select","required":true,"options":["New Request","Enhancement","Problem","Access Rights","Data Extraction","Others"]},{"key":"software_name","label":"Nama Software / Aplikasi","type":"text","required":false,"placeholder":"Mis. Microsoft Office, Adobe Acrobat"},{"key":"asset_tag","label":"Nomor Aset Perangkat","type":"text","required":false,"placeholder":"AST-12345"}]',
    '["software","aplikasi","install","lisensi","office","excel","adobe","program"]'
  UNION ALL
  SELECT
    'cat-item-email',
    3,
    'Email',
    'Akun email, Outlook/Webmail, grup distribusi, atau kendala kirim/terima.',
    'mail',
    'incident',
    'cat-email',
    'low',
    '[{"key":"service_request_type","label":"Service Request Type","type":"select","required":true,"options":["New Request","Enhancement","Problem","Access Rights","Data Extraction","Others"]},{"key":"email_client","label":"Aplikasi Email","type":"select","required":false,"options":["Outlook Desktop","Webmail","Mobile / Ponsel"]}]',
    '["email","outlook","webmail","mailbox","mail","password","grup"]'
  UNION ALL
  SELECT
    'cat-item-printing',
    4,
    'Printing Service',
    'Printer, scanner, fotokopi, koneksi cetak, atau penggantian toner.',
    'printer',
    'incident',
    'cat-printing',
    'low',
    '[{"key":"service_request_type","label":"Service Request Type","type":"select","required":true,"options":["New Request","Enhancement","Problem","Access Rights","Data Extraction","Others"]},{"key":"printer_name","label":"Nama / Lokasi Printer","type":"text","required":false,"placeholder":"PRN-LT2-HR"},{"key":"location","label":"Lokasi Anda","type":"select","required":false,"options":["Kantor Pusat — Lt. 1","Kantor Pusat — Lt. 2","Kantor Pusat — Lt. 3","Cabang Surabaya","Cabang Bandung","Remote / WFH"]}]',
    '["printing","printer","cetak","scan","scanner","toner","kertas"]'
  UNION ALL
  SELECT
    'cat-item-network',
    5,
    'Network',
    'WiFi, LAN, internet kantor, koneksi VPN, atau akses jaringan.',
    'wifi',
    'incident',
    'cat-network',
    'medium',
    '[{"key":"service_request_type","label":"Service Request Type","type":"select","required":true,"options":["New Request","Enhancement","Problem","Access Rights","Data Extraction","Others"]},{"key":"connection_type","label":"Jenis Koneksi","type":"select","required":false,"options":["WiFi Kantor","LAN / Kabel","VPN Remote","Lainnya"]},{"key":"location","label":"Lokasi Anda","type":"select","required":false,"options":["Kantor Pusat — Lt. 1","Kantor Pusat — Lt. 2","Kantor Pusat — Lt. 3","Cabang Surabaya","Cabang Bandung","Remote / WFH"]}]',
    '["network","jaringan","wifi","lan","internet","vpn","koneksi","putus"]'
  UNION ALL
  SELECT
    'cat-item-core-system',
    6,
    'Core System',
    'Sistem inti bisnis, modul transaksi, enhancement, atau hak akses sistem.',
    'database',
    'incident',
    'cat-core-system',
    'high',
    '[{"key":"service_request_type","label":"Service Request Type","type":"select","required":true,"options":["New Request","Enhancement","Problem","Access Rights","Data Extraction","Others"]},{"key":"module_name","label":"Modul / Menu Terkait","type":"text","required":false,"placeholder":"Mis. Underwriting, Finance, Claims"}]',
    '["core","system","sistem","erp","transaksi","modul","aplikasi bisnis","polis"]'
  UNION ALL
  SELECT
    'cat-item-report-system',
    7,
    'Report System',
    'Pembuatan laporan, penarikan data (data extraction), atau error report.',
    'barChart',
    'service_request',
    'cat-report-system',
    'medium',
    '[{"key":"service_request_type","label":"Service Request Type","type":"select","required":true,"options":["New Request","Enhancement","Problem","Access Rights","Data Extraction","Others"]},{"key":"report_name","label":"Nama Laporan / Data","type":"text","required":false,"placeholder":"Mis. Laporan Produksi Bulanan"},{"key":"period","label":"Periode Data","type":"text","required":false,"placeholder":"Mis. Jan–Okt 2026"}]',
    '["report","laporan","reporting","data","ekstraksi","extraction","dashboard","bi"]'
  UNION ALL
  SELECT
    'cat-item-others',
    8,
    'Others',
    'Permintaan layanan atau kendala IT lainnya di luar kategori di atas.',
    'help',
    'service_request',
    'cat-others',
    'low',
    '[{"key":"service_request_type","label":"Service Request Type","type":"select","required":true,"options":["New Request","Enhancement","Problem","Access Rights","Data Extraction","Others"]},{"key":"other_topic","label":"Topik / Layanan Terkait","type":"text","required":false,"placeholder":"Sebutkan topik layanan atau perangkat"}]',
    '["others","lainnya","lain","bantuan","konsultasi","pertanyaan"]'
) AS v
WHERE EXISTS (SELECT 1 FROM users)
ON CONFLICT (id) DO UPDATE SET
  ord = excluded.ord,
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  ticket_type = excluded.ticket_type,
  category_id = excluded.category_id,
  default_impact = excluded.default_impact,
  form_schema = excluded.form_schema,
  sla_policy_id = excluded.sla_policy_id,
  is_active = 1,
  keywords = excluded.keywords;

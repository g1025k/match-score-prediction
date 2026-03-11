-- =============================================
-- スコア予想サイト - Supabase データベーススキーマ
-- =============================================
-- Supabase の SQL Editor に貼り付けて実行してください

-- matches テーブル（試合情報）
create table if not exists matches (
  id uuid default gen_random_uuid() primary key,
  team1_emoji text default '',
  team1_name text not null,
  team2_emoji text default '',
  team2_name text not null,
  sport text not null,
  tournament text,
  match_datetime timestamptz not null,
  deadline timestamptz,
  live_score_team1 integer,
  live_score_team2 integer,
  final_score_team1 integer,
  final_score_team2 integer,
  is_final boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- predictions テーブル（スコア予想）
create table if not exists predictions (
  id uuid default gen_random_uuid() primary key,
  match_id uuid references matches(id) on delete cascade not null,
  user_name text not null,
  score_team1 integer not null,
  score_team2 integer not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS (Row Level Security) を有効化
alter table matches enable row level security;
alter table predictions enable row level security;

-- 全ユーザーに読み書き許可（管理者認証はクライアント側で管理）
create policy "Allow all on matches" on matches
  for all to anon using (true) with check (true);

create policy "Allow all on predictions" on predictions
  for all to anon using (true) with check (true);

-- updated_at を自動更新するトリガー関数
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger matches_updated_at
  before update on matches
  for each row execute function update_updated_at();

create trigger predictions_updated_at
  before update on predictions
  for each row execute function update_updated_at();

-- Realtime を有効化
-- ※ Supabaseダッシュボード > Database > Replication から
--    matches と predictions テーブルを有効化してください

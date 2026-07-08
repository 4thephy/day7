import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_LOGINSUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_LOGINSUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("⚠️ Warning: Supabase 환경 변수가 설정되지 않았습니다. Vercel 설정 또는 .env.local 파일을 확인해 주세요.");
}

export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || ''
);

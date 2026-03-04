import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yyazxermqqbkyliqmrmg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zaodl0nXu26XPzuZOM1EFQ_zD6-in52';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

import { createClient } from '@supabase/supabase-js';
import { handleApiStatus } from '@AiDigital-com/design-system/server';

const APP_NAME = 'campaign-brief-wizard';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export default async (req: Request) => {
  return handleApiStatus(req, APP_NAME, getSupabase());
};

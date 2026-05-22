import { createLogger } from '@AiDigital-com/design-system-sdk/server';
import { supabase } from './supabase.js';

export const log = createLogger(supabase as any, 'campaign-brief-wizard');

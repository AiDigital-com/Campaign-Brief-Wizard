import { createLogger } from '@AiDigital-com/design-system/logger';
import { supabase } from './supabase.js';

export const log = createLogger(supabase as any, 'campaign-brief-wizard');

import { createLogger } from '@AiDigital-com/design-system/logger';
import { supabase } from './supabase.js';

// TODO: Change 'your-app-name' to your app's tool ID
export const log = createLogger(supabase as any, 'your-app-name');

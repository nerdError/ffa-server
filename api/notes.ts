// api/notes.ts
import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Инициализируем клиент Supabase, используя переменные окружения
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  // Обрабатываем только GET-запросы для этого примера
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  // Запрашиваем данные из таблицы notes
  const { data, error } = await supabase
    .from('notes')
    .select('*');

  if (error) {
    console.error('Supabase error:', error);
    return response.status(500).json({ error: error.message });
  }

  // Возвращаем данные
  return response.status(200).json({ notes: data });
}
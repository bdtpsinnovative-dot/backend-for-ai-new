import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const { data, error } = await supabase
  .from('orders')
  .select(`
    id, 
    created_at, 
    customer_name,
    note,
    companies(name),
    order_items (
      id, 
      note, 
      interest_level,
      images,
      product_categories(name),
      order_item_projects (
        area_sqm,
        projects (
          project_name
        )
      )
    )
  `)
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .range(from, to);
  
    if (error) throw error;

    return NextResponse.json(data);

  } catch (error: any) {
  console.error('Full Error Details:', error); 
  return NextResponse.json({ error: error.message }, { status: 500 });
}
}
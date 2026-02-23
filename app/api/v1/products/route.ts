// app/api/v1/products/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword') || '';

    // ✅ ดึงจาก .env ตามความฉลาดของพี่ชายเป๊ะๆ ปลอดภัย 100%
    const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    // ดักไว้หน่อย เผื่อลืมใส่ .env
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Server Config Error: Missing Supabase Env Variables' }, { status: 500 });
    }

    let url = `${supabaseUrl}/rest/v1/products?select=*,product_variants(*)&order=id.asc`;
    if (keyword) {
      url += `&name=ilike.*${keyword}*`;
    }

    const response = await fetch(url, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store' 
    });

    if (!response.ok) throw new Error(`Supabase Error: ${response.status}`);

    const rawData = await response.json();

    // ✅ นวดข้อมูลที่ฝั่ง Backend
    const formattedData = rawData.map((item: any) => {
      const variants = item.product_variants || [];
      
      let minPrice = 0;
      let maxPrice = 0;
      
      if (variants.length > 0) {
        const prices = variants.map((v: any) => Number(v.price || 0));
        minPrice = Math.min(...prices);
        maxPrice = Math.max(...prices);
      }
      
      const imageUrl = item.image_url || (variants.length > 0 ? variants[0].variant_image : '');

      return {
        id: item.id,
        name: item.name || 'ไม่มีชื่อสินค้า',
        collection: item.collection || '',
        image: imageUrl,
        minPrice: minPrice,
        maxPrice: maxPrice,
        variants: variants, 
      };
    });

    return NextResponse.json({ 
      success: true, 
      data: formattedData 
    }, { status: 200 });

  } catch (error: any) {
    console.error("Fetch Products Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
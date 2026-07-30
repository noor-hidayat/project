import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function ProductInfo({ productCode }) {
  const [productName, setProductName] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productCode) {
      setProductName(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    supabase
      .from("products")
      .select("name")
      .eq("code", productCode)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        setLoading(false);
        if (data) {
          setProductName(data.name);
        } else {
          setProductName("(kode tidak ditemukan)");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [productCode]);

  if (!productCode) return null;

  return (
    <div className="product-info">
      <div className="product-info-icon">P</div>
      <div className="product-info-text">
        <div className="label">Produk</div>
        <div className="code">{productCode}</div>
        <div className={`name${!loading && productName === "(kode tidak ditemukan)" ? " not-found" : ""}`}>
          {loading ? "Mencari..." : productName}
        </div>
      </div>
    </div>
  );
}

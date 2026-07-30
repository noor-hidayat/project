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
      .then(({ data, error }) => {
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
      <strong>Kode Produk:</strong> {productCode}
      <br />
      <strong>Nama Produk:</strong>{" "}
      {loading ? "Mencari..." : productName}
    </div>
  );
}

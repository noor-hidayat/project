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
    <div className="card mb-3">
      <div className="card-body d-flex align-items-center gap-3">
        <div className="text-secondary d-flex align-items-center justify-content-center" style={{width:48,height:48}}>
          <i className="bi bi-box-seam fs-4"/>
        </div>
        <div>
          <div className="text-muted small">Produk</div>
          <div className="fw-bold">{productCode}</div>
          <div className={`text-${!loading && productName === "(kode tidak ditemukan)" ? "danger" : "muted"}`}>
            {loading ? "Mencari..." : productName}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ImagePlus, PackagePlus, Pencil, Search, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isProductImageWithinUploadLimit } from '../lib/product-upload';

interface Option { id: number; name: string }
interface Product {
  id: number;
  name: string;
  slug: string;
  description: string;
  price: string;
  compareAtPrice: string | null;
  categoryId: number | null;
  brandId: number | null;
  categoryName: string | null;
  brandName: string | null;
  images: string[];
  thumbnail: string;
  stock: number | null;
  scale: string | null;
  terrain: string | null;
  driveType: string | null;
  batteryType: string | null;
  skillLevel: string | null;
  featured: boolean | null;
  newArrival: boolean | null;
  isPublished: boolean;
}

interface ProductForm {
  name: string;
  slug: string;
  description: string;
  price: string;
  compareAtPrice: string;
  categoryId: number;
  brandId: number;
  images: string[];
  stock: number;
  scale: string;
  terrain: string;
  driveType: string;
  batteryType: string;
  skillLevel: string;
  featured: boolean;
  newArrival: boolean;
}

const emptyForm: ProductForm = {
  name: '', slug: '', description: '', price: '', compareAtPrice: '', categoryId: 0, brandId: 0,
  images: [], stock: 0, scale: '', terrain: '', driveType: '', batteryType: '', skillLevel: '',
  featured: false, newArrival: false,
};

function formFromProduct(product: Product): ProductForm {
  return {
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: product.price,
    compareAtPrice: product.compareAtPrice || '',
    categoryId: product.categoryId || 0,
    brandId: product.brandId || 0,
    images: product.images?.length ? product.images : [product.thumbnail],
    stock: product.stock || 0,
    scale: product.scale || '',
    terrain: product.terrain || '',
    driveType: product.driveType || '',
    batteryType: product.batteryType || '',
    skillLevel: product.skillLevel || '',
    featured: product.featured || false,
    newArrival: product.newArrival || false,
  };
}

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function AdminProductsPage() {
  const { session } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [publicationBusy, setPublicationBusy] = useState<number | null>(null);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = session?.access_token;
    if (!token) throw new Error('Your session expired. Sign in again.');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !(init.body instanceof Blob)) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...init, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = Array.isArray(data.details) ? ` ${data.details.map((item: { message: string }) => item.message).join(' ')}` : '';
      throw new Error(`${data.error || 'Request failed.'}${details}`);
    }
    return data;
  }, [session?.access_token]);

  const loadProducts = useCallback(async (searchText = '') => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchText.trim()) params.set('search', searchText.trim());
      const rows = await request(`/api/admin/products?${params}`, { method: 'GET' });
      setProducts(rows.map((row: { product: Product; brandName: string | null; categoryName: string | null }) => ({
        ...row.product,
        brandName: row.brandName,
        categoryName: row.categoryName,
      })));
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not load products.');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      try {
        const options = await request('/api/admin/options', { method: 'GET' });
        if (active) {
          setCategories(options.categories);
          setBrands(options.brands);
        }
      } catch (cause) {
        if (active) setFormError(cause instanceof Error ? cause.message : 'Could not load product options.');
      }
    }
    void loadOptions();
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProducts(search); }, 180);
    return () => window.clearTimeout(timer);
  }, [loadProducts, search]);

  function beginCreate() {
    setEditing(null);
    setForm({ ...emptyForm, categoryId: categories[0]?.id || 0, brandId: brands[0]?.id || 0 });
    setFormError('');
    setNotice('');
    setEditorOpen(true);
  }

  function beginEdit(product: Product) {
    setEditing(product);
    setForm(formFromProduct(product));
    setFormError('');
    setNotice('');
    setEditorOpen(true);
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setNotice('');
    setSaving(true);
    try {
      const path = editing ? `/api/admin/products/${editing.id}` : '/api/admin/products';
      await request(path, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(form) });
      setNotice(editing ? 'Product changes saved.' : 'Draft created. Publish it when you are ready.');
      setEditorOpen(false);
      await loadProducts(search);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not save this product.');
    } finally {
      setSaving(false);
    }
  }

  async function setPublished(product: Product, isPublished: boolean) {
    setPublicationBusy(product.id);
    setFormError('');
    setNotice('');
    try {
      await request(`/api/admin/products/${product.id}/publication`, {
        method: 'PATCH',
        body: JSON.stringify({ isPublished }),
      });
      setNotice(isPublished ? `${product.name} published.` : `${product.name} unpublished.`);
      await loadProducts(search);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not update publication status.');
    } finally {
      setPublicationBusy(null);
    }
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;
    if (Array.from(files).some((file) => !isProductImageWithinUploadLimit(file.size))) {
      setFormError('Each image must be 4 MiB or smaller.');
      return;
    }
    setUploading(true);
    setFormError('');
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const url = await request('/api/admin/uploads', {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        uploaded.push(url.url);
      }
      setForm((current) => ({ ...current, images: [...current.images, ...uploaded].slice(0, 12) }));
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Image upload failed.');
    } finally {
      setUploading(false);
    }
  }

  const fieldClass = 'mt-2 w-full bg-[#111] border border-white/10 rounded-sm p-3 text-sm text-white focus:border-accent outline-none';

  return (
    <main className="pt-32 pb-24 min-h-screen">
      <div className="container px-4 md:px-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 border-b border-white/10 pb-8 mb-8">
          <div>
            <p className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] mb-2">Owner Control</p>
            <h1 className="text-3xl md:text-4xl italic">PRODUCT GARAGE</h1>
            <p className="text-sm text-muted-foreground mt-2">Manage catalog details, images and publication status.</p>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-wrap gap-2">
              <Link to="/admin/orders" className="btn-secondary px-5 py-3 text-xs">ORDERS</Link>
              <Link to="/admin/inquiries" className="btn-secondary px-5 py-3 text-xs">INQUIRIES</Link>
            </div>
            <button onClick={beginCreate} className="btn-primary px-5 py-3 text-xs"><span className="skew-x-[10deg] flex gap-2 items-center"><PackagePlus size={16} /> ADD PRODUCT</span></button>
          </div>
        </div>

        {notice && <p role="status" className="mb-4 p-3 border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 text-sm">{notice}</p>}
        {formError && <p role="alert" className="mb-4 p-3 border border-red-500/30 bg-red-500/5 text-red-300 text-sm">{formError}</p>}

        {editorOpen && <section className="glass-card p-5 md:p-8 border border-accent/30 bg-[#090909] mb-8">
          <div className="flex items-center justify-between mb-6">
            <div><p className="text-accent text-[10px] font-bold uppercase tracking-[0.25em]">{editing ? 'Edit catalog item' : 'New draft'}</p><h2 className="text-xl md:text-2xl italic mt-1">{editing ? editing.name : 'ADD A PRODUCT'}</h2></div>
            <button type="button" onClick={() => setEditorOpen(false)} className="p-2 text-muted-foreground hover:text-white" aria-label="Close editor"><X /></button>
          </div>
          <form onSubmit={saveProduct} className="grid md:grid-cols-2 gap-5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Product name
              <input required maxLength={200} value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value, slug: editing ? v.slug : slugify(e.target.value) }))} className={fieldClass} />
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Slug
              <input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={120} value={form.slug} onChange={(e) => setForm((v) => ({ ...v, slug: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground md:col-span-2">Description
              <textarea required maxLength={10000} rows={4} value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Price (INR)
              <input required type="number" min="0.01" max="99999999.99" step="0.01" value={form.price} onChange={(e) => setForm((v) => ({ ...v, price: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Compare-at price (INR)
              <input type="number" min="0.01" max="99999999.99" step="0.01" value={form.compareAtPrice} onChange={(e) => setForm((v) => ({ ...v, compareAtPrice: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Category
              <select required value={form.categoryId || ''} onChange={(e) => setForm((v) => ({ ...v, categoryId: Number(e.target.value) }))} className={fieldClass}><option value="" disabled>Select category</option>{categories.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Brand
              <select required value={form.brandId || ''} onChange={(e) => setForm((v) => ({ ...v, brandId: Number(e.target.value) }))} className={fieldClass}><option value="" disabled>Select brand</option>{brands.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Stock
              <input required type="number" min="0" max="1000000" step="1" value={form.stock} onChange={(e) => setForm((v) => ({ ...v, stock: Number(e.target.value) }))} className={fieldClass} />
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Scale
              <input maxLength={50} value={form.scale} onChange={(e) => setForm((v) => ({ ...v, scale: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Terrain
              <input maxLength={150} value={form.terrain} onChange={(e) => setForm((v) => ({ ...v, terrain: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Drive type
              <input maxLength={100} value={form.driveType} onChange={(e) => setForm((v) => ({ ...v, driveType: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Battery
              <input maxLength={100} value={form.batteryType} onChange={(e) => setForm((v) => ({ ...v, batteryType: e.target.value }))} className={fieldClass} />
            </label>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Skill level
              <input maxLength={50} value={form.skillLevel} onChange={(e) => setForm((v) => ({ ...v, skillLevel: e.target.value }))} className={fieldClass} />
            </label>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between gap-4 mb-3"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Product images</p><p className="text-[11px] text-muted-foreground mt-1">The first image is used as the card thumbnail.</p></div><label className="btn-secondary px-4 py-2 text-[10px] cursor-pointer flex items-center gap-2"><Upload size={14} />{uploading ? 'UPLOADING…' : 'UPLOAD IMAGES'}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple disabled={uploading} onChange={(e) => { void uploadImages(e.target.files); e.currentTarget.value = ''; }} /></label></div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {form.images.map((image, index) => <div key={`${image}-${index}`} className="relative aspect-square bg-[#111] border border-white/10 p-2"><img src={image} alt={`Product image ${index + 1}`} className="w-full h-full object-contain" /><button type="button" onClick={() => setForm((v) => ({ ...v, images: v.images.filter((_, i) => i !== index) }))} className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-1" aria-label={`Remove image ${index + 1}`}><X size={12} /></button></div>)}
                {!form.images.length && <div className="aspect-square border border-dashed border-white/20 flex items-center justify-center text-muted-foreground"><ImagePlus /></div>}
              </div>
            </div>

            <div className="md:col-span-2 flex flex-wrap gap-x-6 gap-y-3">
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={form.featured} onChange={(e) => setForm((v) => ({ ...v, featured: e.target.checked }))} /> Featured</label>
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={form.newArrival} onChange={(e) => setForm((v) => ({ ...v, newArrival: e.target.checked }))} /> New arrival</label>
            </div>
            {formError && <p role="alert" className="md:col-span-2 text-sm text-red-300">{formError}</p>}
            <div className="md:col-span-2 flex justify-end gap-3 border-t border-white/10 pt-5">
              <button type="button" onClick={() => setEditorOpen(false)} className="btn-secondary px-5 py-3 text-xs">CANCEL</button>
              <button disabled={saving || uploading} className="btn-primary px-5 py-3 text-xs disabled:opacity-50"><span className="skew-x-[10deg]">{saving ? 'SAVING…' : editing ? 'SAVE CHANGES' : 'SAVE AS DRAFT'}</span></button>
            </div>
          </form>
        </section>}

        <div className="glass-card border border-white/5 bg-[#080808]">
          <div className="p-4 md:p-5 flex flex-col sm:flex-row gap-4 sm:items-center justify-between border-b border-white/5">
            <div><h2 className="text-base font-bold uppercase italic">Catalog inventory</h2><p className="text-xs text-muted-foreground mt-1">{products.length} products</p></div>
            <label className="relative sm:w-80"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products or slugs" className="w-full bg-[#111] border border-white/10 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-accent" /></label>
          </div>
          {loading ? <p role="status" className="p-10 text-center text-sm text-muted-foreground">Loading products…</p> : products.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">No products found.</p> : <div className="divide-y divide-white/5">
            {products.map((product) => <article key={product.id} className="p-4 md:px-5 flex flex-col md:flex-row md:items-center gap-4">
              <img src={product.thumbnail} alt="" className="w-20 h-16 object-contain bg-black border border-white/5 p-1" />
              <div className="min-w-0 flex-1"><h3 className="font-bold text-sm truncate">{product.name}</h3><p className="text-xs text-muted-foreground mt-1">/{product.slug} · {product.brandName || 'No brand'} · {product.categoryName || 'No category'} · ₹{product.price}</p></div>
              <span className={`self-start md:self-auto text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 border ${product.isPublished ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/5' : 'border-amber-500/30 text-amber-300 bg-amber-500/5'}`}>{product.isPublished ? 'Published' : 'Draft'}</span>
              <div className="flex gap-2">
                <button onClick={() => beginEdit(product)} className="btn-secondary p-2" title="Edit product"><Pencil size={15} /></button>
                <button disabled={publicationBusy === product.id} onClick={() => void setPublished(product, !product.isPublished)} className={`text-[10px] font-bold uppercase border px-3 py-2 disabled:opacity-50 ${product.isPublished ? 'border-white/10 text-muted-foreground hover:text-white' : 'border-accent/40 text-accent hover:bg-accent/10'}`}>{publicationBusy === product.id ? 'WAIT…' : product.isPublished ? 'UNPUBLISH' : 'PUBLISH'}</button>
              </div>
            </article>)}
          </div>}
        </div>
      </div>
    </main>
  );
}

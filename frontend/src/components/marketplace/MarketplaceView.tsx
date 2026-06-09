'use client';

import { useState, useEffect } from 'react';
import { Store, ShoppingCart, Plus, Tag } from 'lucide-react';
import { useMarketplaceStore } from '@/stores/marketplaceStore';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, formatTK } from '@/lib/utils';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

export default function MarketplaceView() {
  const { products, fetchProducts, createProduct, purchaseProduct, isLoading } = useMarketplaceStore();
  const { user } = useAuthStore();
  const isMobile = useIsMobile(960);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newType, setNewType] = useState('digital');

  useEffect(() => { fetchProducts(1); }, [fetchProducts]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newPrice) return;
    await createProduct({
      title: newTitle,
      description: newDesc || undefined,
      price_tk: parseFloat(newPrice),
      product_type: newType as any,
    } as any);
    setShowCreate(false);
    setNewTitle('');
    setNewDesc('');
    setNewPrice('');
  };

  const handlePurchase = async (id: string) => {
    if (!confirm('Purchase this item?')) return;
    await purchaseProduct(id);
  };

  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', isMobile ? 'p-4 pb-24' : 'p-6')}>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Store className="w-5 h-5 text-rogan-500" />
            Marketplace
          </h2>
          {user?.role === 'creator' && (
            <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 bg-rogan-600 hover:bg-rogan-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors">
              <Plus className="w-4 h-4" /> List Item
            </button>
          )}
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="bg-surface rounded-xl p-5 border border-white/5 space-y-3">
            <h3 className="text-white font-semibold">List a New Item</h3>
            <input type="text" placeholder="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
            <textarea placeholder="Description" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50 resize-none" />
            <div className="flex gap-3">
              <input type="number" placeholder="Price (TK)" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-rogan-500/50" />
              <select value={newType} onChange={(e) => setNewType(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-rogan-500/50">
                <option value="digital">Digital</option>
                <option value="payperview">Pay-Per-View</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={isLoading} className="flex-1 py-2.5 bg-rogan-600 text-white font-medium rounded-lg text-sm disabled:opacity-50">{isLoading ? 'Creating...' : 'Create Listing'}</button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 bg-white/5 text-white/60 rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Products Grid */}
        {isLoading && products.length === 0 ? <LoadingSpinner /> : products.length === 0 ? (
          <EmptyState icon={Store} title="No Listings Yet" description="Be the first to list a service or product!" />
        ) : (
          <div className={cn('grid gap-4', isMobile ? 'grid-cols-2' : 'grid-cols-3 lg:grid-cols-4')}>
            {products.map((product) => (
              <div key={product.id} className="bg-surface rounded-xl border border-white/5 overflow-hidden hover:border-rogan-500/20 transition-colors group">
                <div className="aspect-square bg-gradient-to-br from-purple-600/20 to-rogan-600/20 flex items-center justify-center">
                  <Tag className="w-8 h-8 text-white/20" />
                </div>
                <div className="p-3">
                  <p className="text-white text-sm font-medium truncate">{product.title}</p>
                  <p className="text-white/30 text-xs truncate">{product.description || product.product_type}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-tk text-sm font-bold">{formatTK(product.price_tk)} TK</span>
                    <button onClick={() => handlePurchase(product.id)} className="px-3 py-1 bg-rogan-600/20 hover:bg-rogan-600 text-rogan-400 hover:text-white text-xs rounded-lg transition-colors flex items-center gap-1">
                      <ShoppingCart className="w-3 h-3" /> Buy
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

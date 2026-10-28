import { listStores } from '@/lib/data';
import { StoreSettings } from './StoreSettings';

export default async function SettingsPage() {
  const stores = await listStores(true);
  return <StoreSettings stores={stores.map((s) => ({ id: s.id, name: s.name, active: s.active, b: [s.budget_weekday, s.budget_friday, s.budget_weekend] }))} />;
}

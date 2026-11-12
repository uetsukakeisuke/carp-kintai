'use client';
import { PageError } from '@/components/PageError';
export default function Error(p: { error: Error & { digest?: string }; reset: () => void }) { return <PageError {...p} home="/me/punch" />; }

import { useCallback, useEffect, useState } from 'react';

export interface GalleryImage {
  src: string;
  alt: string;
}

interface ImageLightboxProps {
  images: GalleryImage[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);

  const goPrev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : images.length - 1)), [images.length]);
  const goNext = useCallback(() => setIndex((i) => (i < images.length - 1 ? i + 1 : 0)), [images.length]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') goPrev();
      if (event.key === 'ArrowRight') goNext();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goPrev, goNext]);

  const current = images[index];
  if (!current) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={current.alt}>
      <button type="button" className="lightbox-nav lightbox-prev" onClick={(e) => { e.stopPropagation(); goPrev(); }} aria-label="上一张">&lsaquo;</button>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={current.src} alt={current.alt} className="lightbox-image" />
        <div className="lightbox-counter">{index + 1} / {images.length}</div>
      </div>
      <button type="button" className="lightbox-nav lightbox-next" onClick={(e) => { e.stopPropagation(); goNext(); }} aria-label="下一张">&rsaquo;</button>
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="关闭预览">&times;</button>
    </div>
  );
}

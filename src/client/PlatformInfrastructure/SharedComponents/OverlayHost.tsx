// 浮在畫面最上層的東西（視窗、提示區）的放置點：由外殼放一份，畫在 body 底下，不受頁面版面影響。

import { createPortal } from 'react-dom';

import { ModalStack } from './modals.tsx';
import { NoticeArea } from './notices.tsx';

/** 視窗和提示區；外殼畫一份就好。提示區疊在視窗上面，開著視窗時也看得到提示。 */
export function OverlayHost() {
  return createPortal(
    <>
      <ModalStack />
      <NoticeArea />
    </>,
    document.body,
  );
}

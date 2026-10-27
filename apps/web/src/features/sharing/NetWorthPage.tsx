import { useParams } from '@tanstack/react-router';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { useSharingDetail, useSyncStatus } from './queries';
import { useShareBook } from './share-hooks';
import { NetWorthSection } from './SharingSection';

/** The route's page: Share › Net worth. For now it holds the section as it was; a later task redesigns it. */
export function NetWorthPage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId/share/net-worth' });
  const book = useShareBook(bookId);
  const detail = useSharingDetail(bookId);
  const live = useSyncStatus(bookId);
  return (
    <div className={SCREEN}>
      <PushedTitle title="Net worth" back="Share" backTo="/account/workspaces/$bookId/share" backParams={{ bookId }} />
      <div className="pt-[2px]">
        {book && detail.data ? (
          <NetWorthSection bookId={bookId} detail={detail.data} groupFailing={live.groupFailing} />
        ) : detail.isSuccess || book === null ? (
          <InsetGroup wide>
            <InsetRow title="That workspace is not shared." chevron={false} />
          </InsetGroup>
        ) : null}
      </div>
    </div>
  );
}

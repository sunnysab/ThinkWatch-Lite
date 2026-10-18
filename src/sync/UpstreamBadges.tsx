import type { KeyboardEvent, MouseEvent } from "react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Tip } from "@/ui/tip";
import { useResource } from "@/lib/resource";
import { useIgnored } from "@/ignore";
import { whenMinute } from "@/format";
import { useText } from "@/i18n";
import type { ProviderView } from "@/types";
import { SYNC_KEYS, syncApi } from "./api";
import { upstreamBadgesText } from "./UpstreamBadges.i18n";
import { syncOn } from "./useSync";

/** 行里自己能点的：点击、按键不冒泡成「打开这一行」（弹层挂在行的 React 树里，也一样） */
const keep = {
  onClick: (e: MouseEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
};

/**
 * 上游行名字后面的两个同步标签（方案 6.2、6.3）：
 *
 * - **不同步**：开着同步、这一家在「不同步的上游」里；
 * - **地址经同步变更**：不加密同步时，这一家的地址被别的设备改了。**提示一次**：点开看
 *   从哪儿改到哪儿、哪台设备改的，「标为已读」之后不再出现（记在这台电脑上），再变一次才
 *   又出现。
 *
 * 同步状态和设置、上游页顶上的提示是同一份缓存（那两处挂着事件，这里只读）。
 */
export function SyncBadges({ p }: { p: ProviderView }) {
  const t = useText(upstreamBadgesText);
  const sync = useResource(SYNC_KEYS.status, syncApi.status);
  const v = sync.data;
  const excluded = syncOn(v) && v.excluded.includes(p.name);
  const change = p.sync_url_changed ?? null;
  const read = useIgnored(`sync-url:${p.name}`, change ? `${change.at_ms}` : "", (a, b) => a === b);
  const showChange = !!change && !read.ignored;
  if (!excluded && !showChange) return null;
  return (
    <>
      {excluded && (
        <Tip text={<p className="max-w-72">{t.notSyncedTip}</p>}>
          <Badge variant="outline" className="@max-3xl/page:hidden">
            {t.notSynced}
          </Badge>
        </Tip>
      )}
      {showChange && change && (
        <span className="inline-flex shrink-0" {...keep}>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex rounded-4xl focus-visible:outline-2 focus-visible:outline-ring/50">
                <Badge variant="warning">{t.urlChanged}</Badge>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 gap-2" onContextMenu={(e) => e.stopPropagation()}>
              <p className="tw-head">{t.urlChangedTitle}</p>
              <p className="tw-body break-all">{t.urlChangedBody(change.from, p.base_url)}</p>
              <p className="tw-label text-muted-foreground">
                {change.device ? t.by(change.device, whenMinute(change.at_ms)) : t.when(whenMinute(change.at_ms))}
              </p>
              <p className="tw-label text-muted-foreground">{t.plainNote}</p>
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={read.ignore}>
                  {t.markRead}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </span>
      )}
    </>
  );
}

import { Fragment, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { invalidate, useResource } from "@/lib/resource";
import { Badge } from "@/ui/badge";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { notify } from "@/ui/notify";
import { Loadable, TableSkeleton } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { whenMinute } from "@/format";
import { PluginConfirmNotice } from "@/ConfigText";
import { needsConfirmation } from "@/plugins/write";
import { DialogError } from "@/upstreams/parts";
import type { BackupEntry, RestorePreview, RestoreRow } from "@/types";
import { BACKUPS_KEY, backupApi } from "./api";
import { backupText } from "./backup.i18n";
import { groupBy, itemLabel, kindLabel, namedById, originLabel, refKey } from "./items";

const STALE = "control.config_stale";

/** 能勾的行：要删掉的网关密钥本机客户端正在用的，core 保留它，不给勾 */
const selectable = (r: RestoreRow) => r.kept === null;

/**
 * 恢复一个备份版本（规格 7.2）：按项目列出该版本与当前配置的差异，缺省全勾，即整体换成该版本；
 * 取消勾选的保持当前内容。本机设置和同名 ChatGPT 上游的登录由 core 保留当前的。
 *
 * 恢复本身也是一个新版本，可以再恢复回来。
 */
export function RestoreDialog({
  entry,
  onClose,
  onRestored,
  onOpenPlugins,
}: {
  entry: BackupEntry;
  onClose: () => void;
  onRestored?: () => void;
  /** 关掉这里、去插件页（恢复的版本要装上、启用改得了工具调用的插件时） */
  onOpenPlugins?: () => void;
}) {
  const t = useText(backupText);
  const c = useText(commonText);
  const [round, setRound] = useState(0);
  const preview = useResource(`restore-preview:${entry.id}`, () => backupApi.restorePreview(entry.id), {
    deps: [round],
  });
  /** 取消勾选的（其余都恢复） */
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pluginRefusal, setPluginRefusal] = useState<string | null>(null);
  const at = whenMinute(entry.at_ms);

  // 重新预览之后差异变了：取消勾选的那几项里不在了的去掉
  useEffect(() => {
    const keys = new Set((preview.data?.rows ?? []).map((r) => refKey(r.item)));
    setUnchecked((u) => (Array.from(u).every((k) => keys.has(k)) ? u : new Set(Array.from(u).filter((k) => keys.has(k)))));
  }, [preview.data]);

  async function run(p: RestorePreview) {
    setBusy(true);
    setError(null);
    setPluginRefusal(null);
    try {
      const rows = p.rows.filter(selectable);
      const items = unchecked.size === 0 ? null : rows.filter((r) => !unchecked.has(refKey(r.item))).map((r) => r.item);
      await backupApi.restore(entry.id, p.base_version, items);
      notify.success(t.restored(at));
      invalidate(BACKUPS_KEY);
      onRestored?.();
      onClose();
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === STALE) setStale(true);
      else if (needsConfirmation(e)) setPluginRefusal(errorText(e));
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const p = preview.data;
  const rows = p?.rows ?? [];
  const chosen = rows.filter((r) => selectable(r) && !unchecked.has(refKey(r.item))).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[86vh] flex-col gap-3 sm:max-w-[640px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="tw-title">{t.restoreVersion(at)}</DialogTitle>
          <DialogDescription>
            {originLabel(entry.origin, entry.device)} · {t.restoreDescription}
          </DialogDescription>
        </DialogHeader>

        <Banner
          show={stale}
          layout="inline"
          tone="warning"
          title={t.stale}
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setStale(false);
                setRound((r) => r + 1);
              }}
            >
              {t.previewAgain}
            </Button>
          }
        />
        {pluginRefusal && (
          <PluginConfirmNotice reason={pluginRefusal} result="notRestored" onOpenPlugins={onOpenPlugins} />
        )}

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto border-y border-border px-4">
          <Loadable
            r={preview}
            loading={<TableSkeleton rows={4} cols={2} />}
            errorTitle={t.previewFailed}
            isEmpty={(d) => d.rows.length === 0}
            empty={<p className="py-6 text-center tw-body text-muted-foreground">{t.unchanged}</p>}
          >
            {(d) => (
              <ChangesTable
                rows={d.rows}
                unchecked={unchecked}
                disabled={busy}
                onToggle={(keys, on) =>
                  setUnchecked((u) => {
                    const next = new Set(u);
                    for (const k of keys) {
                      if (on) next.delete(k);
                      else next.add(k);
                    }
                    return next;
                  })
                }
              />
            )}
          </Loadable>
        </div>

        <DialogError error={error} />

        <DialogFooter className="items-center">
          <span className="mr-auto tw-label text-muted-foreground">
            {p && rows.length > 0 && chosen === 0
              ? t.nothingChecked
              : p && p.sync_devices > 0
                ? t.syncNote(p.sync_devices)
                : null}
          </span>
          <Button variant="outline" onClick={onClose}>
            {c.cancel}
          </Button>
          <Button pending={busy} disabled={!p || chosen === 0 || stale} onClick={() => p && void run(p)}>
            {t.restoreAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 差异表：按类分组，一行一项，前面是勾选框；表头的勾选框管全部 */
function ChangesTable({
  rows,
  unchecked,
  disabled,
  onToggle,
}: {
  rows: readonly RestoreRow[];
  unchecked: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (keys: string[], on: boolean) => void;
}) {
  const t = useText(backupText);
  const keys = rows.filter(selectable).map((r) => refKey(r.item));
  const on = keys.filter((k) => !unchecked.has(k)).length;
  const all = on === keys.length ? true : on === 0 ? false : "indeterminate";
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8">
            <Checkbox
              checked={all}
              disabled={disabled || keys.length === 0}
              aria-label={t.item}
              onCheckedChange={(v) => onToggle(keys, v === true)}
            />
          </TableHead>
          <TableHead>{t.item}</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">{t.change}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groupBy(rows, (r) => r.item).map((g) => (
          <Fragment key={g.kind}>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="bg-muted/40 py-1.5 tw-label font-medium text-muted-foreground">
                {kindLabel(g.kind)}
              </TableCell>
            </TableRow>
            {g.items.map((r) => {
              const k = refKey(r.item);
              return (
                <TableRow key={k} className="hover:bg-transparent">
                  <TableCell>
                    {selectable(r) && (
                      <Checkbox
                        checked={!unchecked.has(k)}
                        disabled={disabled}
                        aria-label={itemLabel(r.item)}
                        onCheckedChange={(v) => onToggle([k], v === true)}
                      />
                    )}
                  </TableCell>
                  <TableCell className={cn("max-w-0 truncate", namedById(r.item) && "font-mono")}>
                    {itemLabel(r.item)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.kept ? (
                      <span className="tw-label text-muted-foreground">{t.keptInUse}</span>
                    ) : (
                      <Badge variant={r.change === "remove" ? "destructive" : r.change === "add" ? "secondary" : "warning"}>
                        {t.changes[r.change]}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

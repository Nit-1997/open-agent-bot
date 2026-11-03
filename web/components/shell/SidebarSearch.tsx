"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isSearchScope, SEARCH_MAX } from "@oab/shared/lists";
import { SEARCH_DEBOUNCE_MS, searchHref } from "@/lib/shell/searchNav";

export function useSearchField() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = pathname === "/search" ? (params.get("q") ?? "") : "";
  const scopeParam = params.get("scope");
  const scope = pathname === "/search" && isSearchScope(scopeParam) ? scopeParam : "all";
  const [text, setText] = useState(urlQ);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pushed = useRef(false);
  const onSearch = pathname === "/search";

  const [seenQ, setSeenQ] = useState(urlQ);
  if (urlQ !== seenQ && !focused) {
    setSeenQ(urlQ);
    setText(urlQ);
  }
  useEffect(() => {
    if (onSearch) pushed.current = false;
  }, [onSearch]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const leave = (q: string) => {
    if (pushed.current) router.replace(searchHref(q, "all"));
    else router.push(searchHref(q, "all"));
    pushed.current = true;
  };
  const change = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    if (!onSearch) leave(next);
    else timer.current = setTimeout(() => router.replace(searchHref(next, scope)), SEARCH_DEBOUNCE_MS);
  };
  const submit = () => {
    clearTimeout(timer.current);
    if (!onSearch) leave(text);
    else router.replace(searchHref(text, scope));
  };
  return {
    text,
    change,
    submit,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}

export function SidebarSearch({
  id,
  placeholder,
  large,
  inputRef,
}: {
  id: string;
  placeholder: string;
  large?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const { text, change, submit, onFocus, onBlur } = useSearchField();
  return (
    <form
      id={id}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={`flex w-full min-w-0 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-text-faint focus-within:border-mist-500 ${large ? "h-11" : "h-10"}`}
    >
      <Search id={`${id}-icon`} aria-hidden="true" size={16} />
      <label id={`${id}-label`} htmlFor={`${id}-input`} className="sr-only">
        Search chats and reports
      </label>
      <input
        id={`${id}-input`}
        ref={inputRef}
        type="search"
        value={text}
        maxLength={SEARCH_MAX}
        placeholder={placeholder}
        onChange={(e) => change(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-faint [&::-webkit-search-cancel-button]:hidden"
      />
    </form>
  );
}

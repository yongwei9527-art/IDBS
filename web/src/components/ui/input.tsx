import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { CircleX, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md' | 'lg' | 'none';

const sizeMap: Record<Exclude<Size, 'none'>, { input: string; wrapper: string }> = {
  sm: { input: 'h-9 text-xs', wrapper: 'min-h-9' },
  md: { input: 'h-10 text-sm', wrapper: 'min-h-10' },
  lg: { input: 'h-11 text-base', wrapper: 'min-h-11' }
};

const inputBase =
  'ui-input flex w-full rounded-md border border-input bg-card px-3 py-1 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';

type BaseProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> & {
  /** 一键清空 */
  clearable?: boolean;
  onClear?: () => void;
  /** 密码可见切换 */
  showPassword?: boolean;
  /** 前缀图标/节点 */
  prefix?: React.ReactNode;
  /** 后缀图标/节点 */
  suffix?: React.ReactNode;
  /** 复合输入前置 */
  prepend?: React.ReactNode;
  /** 复合输入后置 */
  append?: React.ReactNode;
  /** 受控格式化 */
  formatter?: (value: string) => string;
  parser?: (value: string) => string;
  /** 字数统计 */
  maxlength?: number;
  showWordLimit?: boolean;
  wordLimitPosition?: 'inside' | 'outside';
  /** 尺寸 */
  inputSize?: Size;
  /** 自定义清除图标 */
  clearIcon?: React.ReactNode;
};

export interface InputProps extends BaseProps, VariantProps<typeof cvaBase> {}

const cvaBase = cva(inputBase);

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      clearable,
      onClear,
      showPassword,
      prefix,
      suffix,
      prepend,
      append,
      formatter,
      parser,
      maxlength,
      showWordLimit,
      wordLimitPosition = 'inside',
      inputSize = 'md',
      clearIcon,
      type = 'text',
      value,
      defaultValue,
      onChange,
      onFocus,
      onBlur,
      ...rest
    },
    ref
  ) => {
    const [visible, setVisible] = React.useState(false);
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    // 受控/非受控统一
    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = React.useState<string>(
      String(value ?? defaultValue ?? '')
    );
    const current = isControlled ? String(value) : internalValue;
    const display = formatter ? formatter(current) : current;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let next = e.target.value;
      if (formatter && parser) next = parser(next);
      if (!isControlled) setInternalValue(next);
      onChange?.({ ...e, target: { ...e.target, value: next } });
    };

    const effectiveType = showPassword ? (visible ? 'text' : 'password') : type;
    const showClear = clearable && current.length > 0 && !rest.disabled;
    const len = current.length;
    const limitNode =
      showWordLimit && maxlength !== undefined ? (
        <span className="pointer-events-none select-none text-xs text-muted-foreground">
          {len} / {maxlength}
        </span>
      ) : null;
    const sizeCls = inputSize === 'none' ? '' : sizeMap[inputSize].input;

    const inputEl = (
      <input
        ref={innerRef}
        type={effectiveType}
        className={cn(
          inputBase,
          sizeCls,
          (prefix || suffix || showClear || showPassword) && 'pr-9',
          prefix && 'pl-9',
          className
        )}
        value={isControlled ? display : undefined}
        defaultValue={!isControlled ? display : undefined}
        maxLength={maxlength}
        onChange={handleChange}
        onFocus={onFocus}
        onBlur={onBlur}
        {...rest}
      />
    );

    // 复合型 prepend/append
    if (prepend || append) {
      return (
        <div className="flex w-full">
          {prepend && (
            <span className="inline-flex items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
              {prepend}
            </span>
          )}
          <div className="relative flex-1">{inputEl}</div>
          {append && (
            <span className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground">
              {append}
            </span>
          )}
        </div>
      );
    }

    const adornments = prefix || suffix || showClear || showPassword;
    const sizeKey: Exclude<Size, 'none'> = inputSize === 'none' ? 'md' : inputSize;
    const wrapper = (
      <div className={cn('relative flex items-center', inputSize === 'none' ? '' : sizeMap[sizeKey].wrapper)}>
        {prefix && (
          <span className="pointer-events-none absolute left-3 flex items-center text-muted-foreground">
            {prefix}
          </span>
        )}
        {inputEl}
        {(showClear || showPassword || suffix) && (
          <span className="absolute right-2 flex items-center gap-1">
            {showClear && (
              <button
                type="button"
                tabIndex={-1}
                aria-label="清空"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (!isControlled) setInternalValue('');
                  onChange?.({ target: { value: '' } } as any);
                  onClear?.();
                  innerRef.current?.focus();
                }}
              >
                {clearIcon ?? <CircleX className="h-4 w-4" />}
              </button>
            )}
            {showPassword && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={visible ? '隐藏密码' : '显示密码'}
                className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={() => setVisible((v) => !v)}
              >
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            )}
            {suffix}
          </span>
        )}
      </div>
    );

    if (!adornments && wordLimitPosition !== 'outside') {
      return (
        <div className="relative w-full">
          {wrapper}
          {wordLimitPosition === 'inside' && limitNode && (
            <span className="pointer-events-none absolute right-2 bottom-1 select-none text-xs text-muted-foreground bg-card/80 px-1 rounded">
              {len} / {maxlength}
            </span>
          )}
        </div>
      );
    }
    if (wordLimitPosition === 'outside' && limitNode) {
      return (
        <div className="flex flex-col gap-1">
          {adornments ? wrapper : inputEl}
          <div className="flex justify-end">{limitNode}</div>
        </div>
      );
    }
    return wrapper;
  }
);
Input.displayName = 'Input';

export { Input };

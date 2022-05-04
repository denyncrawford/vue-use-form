import type { Ref } from 'vue'
import { reactive, ref, toRefs, unref, watch } from 'vue'
import type {
  FieldNamesMarkedBoolean,
  FormState,
  SubmitErrorHandler,
  SubmitHandler,
  UseFormHandleSubmit,
  UseFormProps,
  UseFormReturn,
} from '../types/form'
import type { Field, FieldElement, FieldValues } from '../types/filed'
import type { FieldError, FieldErrors } from '../types/errors'
import type { RegisterOptions } from '../types/validator'
import { isArray, isEmptyObject, isFunction, isHTMLElement, isNullOrUndefined, isString } from '../utils'
import { VALIDATION_MODE } from '../shared/constant'
import { getValidationMode } from '../utils/getValidationMode'
import type { UnpackNestedValue } from '../types/utils'
import { createErrorHandler as createErrorHandlerUtil, createSubmitHandler as createSubmitHandlerUtil } from '../utils/createHandler'
import { get, set, unset } from '../utils/object'
import { validateField } from './validate'

const onModelValueUpdate = 'onUpdate:modelValue'

export function createForm<
  TFieldValues extends FieldValues = FieldValues,
  TContext = any,
  >(
  _options: UseFormProps<TFieldValues, TContext>,
) {
  // what about use Map?
  const fields = reactive<Partial<Record<keyof TFieldValues, Field>>>({}) as Record<keyof TFieldValues, Field>

  const formState = reactive<FormState<TFieldValues>>({
    isDirty: false,
    isValidating: false,
    dirtyFields: {} as FieldNamesMarkedBoolean<TFieldValues>,
    isSubmitted: false,
    submitCount: 0,
    isSubmitting: false,
    isSubmitSuccessful: false,
    isValid: false,
    errors: {} as FieldErrors<TFieldValues>,
  }) as FormState<TFieldValues>

  const validationModeBeforeSubmit = getValidationMode(_options.mode!)
  const validationModeAfterSubmit = getValidationMode(_options.reValidateMode!)
  const shouldDisplayAllAssociatedErrors
    = _options.criteriaMode === VALIDATION_MODE.all

  const _getDefaultVal = (name: keyof TFieldValues) => {
    return get(_options.defaultValues, name as string) || ''
  }

  const _transformRef = (ref: Ref<FieldElement | any>) => {
    const unwrap = unref(ref)
    let el

    if (isHTMLElement(unwrap))
      el = unwrap

    else if (isHTMLElement(unwrap?.$el))
      el = unwrap.$el

    else if (isHTMLElement(unwrap?.ref?.value))
      el = unwrap.ref.value

    if ((el as FieldElement).tagName === 'INPUT' || (el as FieldElement).tagName === 'SELECT' || (el as FieldElement).tagName === 'TEXTAREA')
      return el

    return el.querySelectorAll('input, select, textarea')[0]
  }

  const _validateFieldByName = async (fieldName: keyof TFieldValues, isValidateAllFields = false) => {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    cleanupUnRegister()
    if (isEmptyObject(fields) || isNullOrUndefined(fields[fieldName])) {
      return
    }
    !isValidateAllFields && set(formState, 'isValidating', true)
    const res = await validateField(fields[fieldName], shouldDisplayAllAssociatedErrors, unref(_options.shouldFocusError)!)
    !isValidateAllFields && set(formState, 'isValidating', false)
    if (Object.keys(res).length) {
      (formState.errors[fieldName] as FieldError) = res
    } else {
      unset(formState.errors, fieldName as string)
    }
  }

  const _validateFields = async () => {
    for (const fieldName of Object.keys(fields)) {
      set(formState, 'isValidating', true)
      await _validateFieldByName(fieldName, true)
      set(formState, 'isValidating', false)
    }
  }

  const _handleDirtyFields = (name: keyof TFieldValues, evt: InputEvent | string) => {
    const inputVal = isString(evt) ? evt : (evt.target as FieldElement).value
    const defaultVal = _getDefaultVal(name)
    if (defaultVal === inputVal) {
      set(formState, 'isDirty', false)
      unset(formState.dirtyFields, name as string)
    } else {
      set(formState, 'isDirty', true)
      set(formState.dirtyFields, name as string, true)
    }
  }

  const onChange = async (name: keyof TFieldValues) => {
    set(formState, 'isValidating', true)
    await _validateFieldByName(name)
    set(formState, 'isValidating', false)

    if (isEmptyObject(formState.errors)) {
      set(formState, 'isValid', true)
    } else {
      set(formState, 'isValid', false)
    }
  }

  const handleSubmit: UseFormHandleSubmit<TFieldValues> = (onSubmit, onError?) => {
    set(formState, 'isSubmitting', true)
    formState.submitCount++
    return async (e) => {
      await _validateFields()
      if (!isEmptyObject(formState.errors)) {
        if (isFunction(onError)) {
          await onError(formState.errors, e)
          set(formState, 'isSubmitting', false)
          set(formState, 'isSubmitted', true)
        }

        return
      }
      const res: Record<string, any> = {}
      for (const fieldName in fields) {
        res[fieldName] = fields[fieldName].inputValue
      }
      await onSubmit(fields as UnpackNestedValue<TFieldValues>, e)
      set(formState, 'isSubmitting', false)
      set(formState, 'isSubmitted', true)
      set(formState, 'isSubmitSuccessful', true)
    }
  }

  const createErrorHandler = (fn: SubmitErrorHandler<TFieldValues>) => createErrorHandlerUtil<TFieldValues>(fn)
  const createSubmitHandler = (fn: SubmitHandler<TFieldValues>) => createSubmitHandlerUtil<TFieldValues>(fn)

  const unRegisterSet = new Set<keyof TFieldValues>()

  const register = (name: keyof TFieldValues, options: RegisterOptions) => {
    const modelVal = ref(fields[name]?.inputValue || '')
    const elRef = ref<FieldElement | null>(null)

    if (!fields[name]) {
      set(fields, name, {} as Field)
      assignBindAttrs()
    }

    if (options.value) {
      set(fields[name], 'inputValue', options.value)
      unset(options, 'value')
    }

    watch(elRef, (newEl) => {
      if (newEl) {
        const el = _transformRef(elRef)
        if (isHTMLElement(el)) {
          if (!isNullOrUndefined(fields[name]))
            fields[name].ref = el as FieldElement
        }
      }
    })

    function assignBindAttrs(el: FieldElement = {} as any, newValue = options.value) {
      elRef.value = el
      modelVal.value = modelVal
      set(fields, name, {
        inputValue: newValue,
        rule: { ...options },
        ref: elRef.value!,
        name: name as string,
      })
    }

    return {
      ref: elRef,
      modelValue: modelVal.value,
      onBlur: () => {
        if (validationModeBeforeSubmit.isOnBlur)
          onChange(name)
      },
      [onModelValueUpdate]: (newValue: TFieldValues[keyof TFieldValues]) => {
        assignBindAttrs(_transformRef(elRef), newValue)
        if (validationModeBeforeSubmit.isOnChange)
          onChange(name)
      },
      onInput(evt: InputEvent) {
        _handleDirtyFields(name, evt)
        // filter UI Component
        if (isString(evt))
          return
        assignBindAttrs(_transformRef(elRef), (evt.target as HTMLInputElement).value)
        if (validationModeBeforeSubmit.isOnChange)
          onChange(name)
      },
    }
  }

  const unregister = (fieldsName: keyof TFieldValues | (keyof TFieldValues)[]) => {
    if (!isArray(fieldsName)) {
      fieldsName = [fieldsName]
    }

    fieldsName.forEach(fieldName => unRegisterSet.add(fieldName))
  }

  const cleanupUnRegister = () => {
    for (const fieldName of unRegisterSet) {
      unset(formState.errors, fieldName as string)
      unset(fields, fieldName as string)
      unset(formState.dirtyFields, fieldName as string)
    }
  }

  const useRegister = (name: keyof TFieldValues, options: RegisterOptions) => () => register(name, options)

  return {
    formState: toRefs(formState),
    register,
    unregister,
    useRegister,
    handleSubmit,
    createSubmitHandler,
    createErrorHandler,
  }
}

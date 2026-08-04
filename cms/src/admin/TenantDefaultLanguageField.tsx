'use client'

import React from 'react'
import { SelectField, useFormFields } from '@payloadcms/ui'
import type { SelectFieldClientProps } from 'payload'

type Props = SelectFieldClientProps

export default function TenantDefaultLanguageField(props: Props) {
  const languages = useFormFields(([fields]) => fields.languages?.value)
  const allowed = new Set(
    Array.isArray(languages)
      ? languages.filter((language): language is string => typeof language === 'string')
      : [],
  )

  const options = Array.isArray(props.field.options)
    ? props.field.options.filter((option) => {
        const value = typeof option === 'string' ? option : option.value
        return typeof value === 'string' && allowed.has(value)
      })
    : props.field.options

  return <SelectField {...props} field={{ ...props.field, options }} />
}

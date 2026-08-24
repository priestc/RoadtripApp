"use client";

import { useEffect, useRef } from "react";
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";
import { inputClass } from "@/components/FormControls";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: string) => void;
  placeholder?: string;
}

/**
 * A text input with Google Places address autocomplete. Falls back to a
 * plain text input if no Maps API key is configured, so the rest of the
 * app doesn't break for local dev before that's set up.
 */
export default function AddressAutocomplete(props: AddressAutocompleteProps) {
  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <input
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className={inputClass}
      />
    );
  }

  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <AddressAutocompleteInner {...props} />
    </APIProvider>
  );
}

function AddressAutocompleteInner({
  value,
  onChange,
  placeholder,
}: AddressAutocompleteProps) {
  const placesLibrary = useMapsLibrary("places");
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // The Autocomplete widget writes directly into the input's DOM value when
  // a suggestion is picked, so this input is intentionally uncontrolled —
  // fighting that with a React-controlled `value` would break selection.
  useEffect(() => {
    if (!placesLibrary || !inputRef.current) return;
    const autocomplete = new placesLibrary.Autocomplete(inputRef.current, {
      types: ["address"],
    });
    const listener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      const address = place.formatted_address ?? inputRef.current?.value ?? "";
      onChangeRef.current(address);
    });
    return () => {
      listener.remove();
      google.maps.event.clearInstanceListeners(autocomplete);
    };
  }, [placesLibrary]);

  // Keep the field in sync when `value` changes from outside (e.g. the
  // saved address loads asynchronously), without clobbering active typing.
  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = value;
    }
  }, [value]);

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputClass}
    />
  );
}

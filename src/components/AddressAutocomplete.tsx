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
 * A text input with Google Places address autocomplete, built on the
 * PlaceAutocompleteElement web component (the legacy google.maps.places.
 * Autocomplete widget isn't available to Google Cloud projects created
 * after March 2025). Falls back to a plain text input if no Maps API key
 * is configured, so the rest of the app doesn't break for local dev before
 * that's set up.
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
  const containerRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<google.maps.places.PlaceAutocompleteElement | null>(
    null
  );
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Create the widget once per (library, placeholder) pair — recreating it
  // on every `value` change would tear down in-progress typing, so that's
  // synced separately below instead.
  useEffect(() => {
    if (!placesLibrary || !containerRef.current) return;

    const element = new placesLibrary.PlaceAutocompleteElement({
      value,
      placeholder: placeholder ?? null,
    });
    elementRef.current = element;
    containerRef.current.appendChild(element);

    const handleSelect = (event: Event) => {
      const { placePrediction } = event as google.maps.places.PlacePredictionSelectEvent;
      (async () => {
        const place = placePrediction.toPlace();
        await place.fetchFields({ fields: ["formattedAddress"] });
        onChangeRef.current(place.formattedAddress ?? element.value ?? "");
      })();
    };
    element.addEventListener("gmp-select", handleSelect);

    return () => {
      element.removeEventListener("gmp-select", handleSelect);
      element.remove();
      elementRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesLibrary, placeholder]);

  // Keep the widget in sync when `value` changes from outside (e.g. the
  // saved address loads asynchronously).
  useEffect(() => {
    if (elementRef.current && elementRef.current.value !== value) {
      elementRef.current.value = value;
    }
  }, [value]);

  return <div ref={containerRef} className="w-full" />;
}

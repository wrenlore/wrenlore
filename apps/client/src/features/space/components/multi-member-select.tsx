import React, { useEffect, useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { Group, MultiSelect, MultiSelectProps, Text } from "@mantine/core";
import { IGroup } from "@/features/group/types/group.types.ts";
import { useSearchSuggestionsQuery } from "@/features/search/queries/search-query.ts";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { IUser } from "@/features/user/types/user.types.ts";
import { IconGroupCircle } from "@/components/icons/icon-people-circle.tsx";
import { useTranslation } from "react-i18next";
import { useSpaceMembersInfiniteQuery } from "@/features/space/queries/space-query.ts";
import { ISpaceMember } from "@/features/space/types/space.types.ts";

interface MultiMemberSelectProps {
  value?: string[];
  onChange: (value: string[]) => void;
  onMembersChange?: (members: MultiMemberOption[]) => void;
  spaceId?: string;
  dropdownWithinPortal?: boolean;
}

export interface MultiMemberOption {
  value: string;
  label: string;
  email?: string;
  avatarUrl?: string | null;
  type: "user" | "group";
}

const renderMultiSelectOption: MultiSelectProps["renderOption"] = ({
  option,
}) => (
  <Group gap="sm" wrap="nowrap">
    {option["type"] === "user" && (
      <CustomAvatar
        avatarUrl={option["avatarUrl"]}
        size={20}
        name={option.label}
      />
    )}
    {option["type"] === "group" && <IconGroupCircle />}
    <div>
      <Text size="sm" lineClamp={1}>
        {option.label}
      </Text>
      {option["type"] === "user" && option["email"] && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {option["email"]}
        </Text>
      )}
    </div>
  </Group>
);

export function MultiMemberSelect({
  value,
  onChange,
  onMembersChange,
  spaceId,
  dropdownWithinPortal = true,
}: MultiMemberSelectProps) {
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState("");
  const [dropdownOpened, setDropdownOpened] = useState(false);
  const [debouncedQuery] = useDebouncedValue(searchValue, 500);
  const useSpaceMembers = !!spaceId;
  const { data: suggestion } = useSearchSuggestionsQuery({
    query: useSpaceMembers ? "" : debouncedQuery,
    includeUsers: true,
    includeGroups: true,
    preload: !useSpaceMembers,
  });
  const { data: spaceMembers } = useSpaceMembersInfiniteQuery(
    spaceId || "",
    debouncedQuery,
  );
  const [data, setData] = useState<
    { group: string; items: MultiMemberOption[] }[]
  >([]);

  useEffect(() => {
    if (useSpaceMembers) return;

    if (suggestion) {
      // Extract user and group items
      const userItems = (suggestion?.users ?? []).map((user: IUser) => ({
        value: `user-${user.id}`,
        label: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        type: "user" as const,
      }));

      const groupItems = (suggestion?.groups ?? []).map((group: IGroup) => ({
        value: `group-${group.id}`,
        label: group.name,
        type: "group" as const,
      }));

      // Create fresh data structure based on current search results
      const newData: { group: string; items: MultiMemberOption[] }[] = [];

      if (userItems && userItems.length > 0) {
        newData.push({
          group: t("Select a user"),
          items: userItems,
        });
      }

      if (groupItems && groupItems.length > 0) {
        newData.push({
          group: t("Select a group"),
          items: groupItems,
        });
      }

      setData(newData);
    }
  }, [suggestion, t, useSpaceMembers]);

  useEffect(() => {
    if (!useSpaceMembers) return;

    const members =
      spaceMembers?.pages.flatMap((page) => page.items ?? []) ?? [];

    const userItems = members
      .filter(
        (member): member is Extract<ISpaceMember, { type: "user" }> =>
          member.type === "user",
      )
      .map((user) => ({
        value: `user-${user.id}`,
        label: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        type: "user" as const,
      }));

    const groupItems = members
      .filter(
        (member): member is Extract<ISpaceMember, { type: "group" }> =>
          member.type === "group",
      )
      .map((group) => ({
        value: `group-${group.id}`,
        label: group.name,
        type: "group" as const,
      }));

    const newData: { group: string; items: MultiMemberOption[] }[] = [];

    if (userItems.length > 0) {
      newData.push({
        group: t("Select a user"),
        items: userItems,
      });
    }

    if (groupItems.length > 0) {
      newData.push({
        group: t("Select a group"),
        items: groupItems,
      });
    }

    setData(newData);
  }, [spaceMembers, t, useSpaceMembers]);

  return (
    <MultiSelect
      data={data}
      value={value}
      renderOption={renderMultiSelectOption}
      hidePickedOptions
      maxDropdownHeight={300}
      label={t("Add members")}
      placeholder={t("Search for users and groups")}
      searchable
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      dropdownOpened={dropdownOpened}
      onDropdownOpen={() => setDropdownOpened(true)}
      onDropdownClose={() => setDropdownOpened(false)}
      onOptionSubmit={() => setDropdownOpened(false)}
      comboboxProps={{ withinPortal: dropdownWithinPortal }}
      filter={({ options }) => options}
      clearable
      variant="filled"
      onChange={(nextValue) => {
        onChange(nextValue);
        onMembersChange?.(
          data
            .flatMap((group) => group.items)
            .filter((item) => nextValue.includes(item.value)),
        );
      }}
      maxValues={50}
    />
  );
}
